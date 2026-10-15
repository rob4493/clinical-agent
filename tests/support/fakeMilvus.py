"""In-memory fake implementing SDK hooks; no socket, real client or server."""

import copy
import json
import math
import re


class FakeMilvus:
    """Provider response shapes match the installed SDK, not clinical behavior."""

    def __init__(self):
        self.collections = {}
        self.calls = []
        self.failMethod = None
        self.failureText = "synthetic provider failure"
        self.queryTransform = None
        self.searchTransform = None
        self.upsertTransform = None
        self.deleteTransform = None

    def recordCall(self, method, arguments):
        self.calls.append((method, copy.deepcopy(arguments)))
        if method == self.failMethod:
            raise RuntimeError(self.failureText)

    # Underscore hooks/keywords below mirror the external MilvusClient API.
    def has_collection(self, **arguments):
        self.recordCall("has_collection", arguments)
        return arguments["collection_name"] in self.collections

    def create_collection(self, **arguments):
        schema = arguments.pop("schema").to_dict()
        indexes = copy.deepcopy(list(arguments.pop("index_params")))
        self.recordCall("create_collection", arguments)
        assert arguments["collection_name"] not in self.collections
        self.collections[arguments["collection_name"]] = {"schema": schema, "indexes": indexes, "rows": {}}

    def describe_collection(self, **arguments):
        self.recordCall("describe_collection", arguments)
        return copy.deepcopy(self.collections[arguments["collection_name"]]["schema"])

    def list_indexes(self, **arguments):
        self.recordCall("list_indexes", arguments)
        return [index["index_name"] for index in self.collections[arguments["collection_name"]]["indexes"]]

    def describe_index(self, **arguments):
        self.recordCall("describe_index", arguments)
        return copy.deepcopy(self.collections[arguments["collection_name"]]["indexes"][0])

    def matches(self, row, expression):
        pairs = [(field, json.loads(encoded)) for field, encoded in re.findall(r'(\w+) == ("(?:\\.|[^"\\])*")', expression)]
        assert pairs and pairs[0][0] == "ModuleId"
        moduleId = pairs.pop(0)[1]
        if row["ModuleId"] != moduleId:
            return False
        if pairs and pairs[0][0] == "Status":
            if row["Status"] != pairs.pop(0)[1]:
                return False
        if not pairs:
            return True
        if len(pairs) == 1:
            assert pairs[0][0] == "PackageId"
            return row["PackageId"] == pairs[0][1]
        assert len(pairs) % 3 == 0
        return any(all(row[field] == content for field, content in pairs[position:position + 3]) for position in range(0, len(pairs), 3))

    def query(self, **arguments):
        self.recordCall("query", arguments)
        rows = [copy.deepcopy({field: row[field] for field in arguments["output_fields"]}) for row in self.collections[arguments["collection_name"]]["rows"].values()
            if self.matches(row, arguments["filter"])][:arguments["limit"]]
        return self.queryTransform(rows) if self.queryTransform is not None else rows

    def upsert(self, **arguments):
        self.recordCall("upsert", arguments)
        if self.upsertTransform is not None:
            return self.upsertTransform(arguments)
        self.collections[arguments["collection_name"]]["rows"].update({row["ChunkId"]: copy.deepcopy(row) for row in arguments["data"]})
        return {"upsert_count": len(arguments["data"])}

    def search(self, **arguments):
        self.recordCall("search", arguments)
        vector = arguments["data"][0]
        metric = arguments["search_params"]["metric_type"]
        results = []
        for row in self.collections[arguments["collection_name"]]["rows"].values():
            if not self.matches(row, arguments["filter"]):
                continue
            if metric == "L2":
                distance = sum((first - second) ** 2 for first, second in zip(vector, row["Vector"]))
            else:
                distance = sum(first * second for first, second in zip(vector, row["Vector"]))
                if metric == "COSINE":
                    distance /= math.sqrt(sum(component ** 2 for component in vector) * sum(component ** 2 for component in row["Vector"]))
            results.append({"id": row["ChunkId"], "distance": distance, "entity": {field: copy.deepcopy(row[field]) for field in arguments["output_fields"]}})
        # Reversed ties ensure the adapter, not insertion/provider order, establishes ranking.
        results = sorted(results, key=lambda result: (result["distance"] if metric == "L2" else -result["distance"], result["id"]), reverse=False)[:arguments["limit"]]
        results.reverse()
        response = [results]
        return self.searchTransform(response) if self.searchTransform is not None else response

    def delete(self, **arguments):
        self.recordCall("delete", arguments)
        if self.deleteTransform is not None:
            return self.deleteTransform(arguments)
        rows = self.collections[arguments["collection_name"]]["rows"]
        selected = [identifier for identifier, row in rows.items() if self.matches(row, arguments["filter"])]
        for identifier in selected:
            del rows[identifier]
        return {"delete_count": len(selected)}
