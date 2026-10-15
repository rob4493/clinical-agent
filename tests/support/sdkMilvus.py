"""Execute installed SDK methods on a plain facade with synthetic transport only."""

import copy
import inspect
from types import MethodType, SimpleNamespace
from unittest.mock import create_autospec

from pymilvus import MilvusClient
from pymilvus.client.grpc_handler import GrpcHandler
from tests.support.fakeMilvus import FakeMilvus


class SdkMilvus:
    """Not a MilvusClient instance: SDK construction and connection lookup are bypassed."""

    def __init__(self):
        self.storage = FakeMilvus()
        self.transport = create_autospec(GrpcHandler, instance=True, spec_set=True)
        self.transport.has_collection.side_effect = lambda name, **options: self.storage.has_collection(collection_name=name, **options)
        self.transport.describe_collection.side_effect = lambda name, **options: self.storage.describe_collection(collection_name=name, **options)
        self.transport.describe_index.side_effect = lambda name, index, **options: self.storage.describe_index(collection_name=name, index_name=index, **options)
        self.transport.create_collection.side_effect = self.createCollection
        self.transport.create_index.side_effect = self.createIndex
        self.transport.load_collection.return_value = None
        self.transport.list_indexes.side_effect = self.listIndexes
        self.transport.upsert_rows.side_effect = self.upsertRows
        self.transport.query.side_effect = self.queryRows
        self.transport.search.side_effect = self.searchRows
        self.transport.delete.side_effect = self.deleteRows
        self.calls = []

    # Required SDK hooks are bound to installed methods, never a real client.
    def _get_connection(self):
        return self.transport

    def __getattr__(self, method):
        operation = getattr(MilvusClient, method)
        def invoke(*arguments, **options):
            inspect.signature(operation).bind(self, *arguments, **options)
            self.calls.append((method, copy.deepcopy(options)))
            return MethodType(operation, self)(*arguments, **options)
        return invoke

    def createCollection(self, name, schema, **options):
        self.storage.create_collection(collection_name=name, schema=schema, index_params=[], **options)

    def createIndex(self, name, field, params, **options):
        self.storage.collections[name]["indexes"].append(dict(field_name=field, index_name=options["index_name"], **copy.deepcopy(params)))

    def listIndexes(self, name, **options):
        return [SimpleNamespace(field_name=index["field_name"], index_name=index["index_name"]) for index in self.storage.collections[name]["indexes"]]

    def upsertRows(self, name, rows, **options):
        result = self.storage.upsert(collection_name=name, data=rows, **options)
        return SimpleNamespace(upsert_count=result.get("upsert_count", 0), cost=0)

    def queryRows(self, name, expr, **options):
        return self.storage.query(collection_name=name, filter=expr, **options)

    def searchRows(self, name, vectors, field, params, expression, **options):
        response = self.storage.search(collection_name=name, data=vectors, anns_field=field, search_params=params, filter=expression, **options)
        class Hit:
            def __init__(self, result):
                self.result = result

            # SDK Hit.to_dict is an external API name.
            def to_dict(self):
                return copy.deepcopy(self.result)

        class Results(list):
            cost = 0
        return Results([[Hit(result) for result in batch] for batch in response])

    def deleteRows(self, name, expression, partition, **options):
        result = self.storage.delete(collection_name=name, filter=expression, **options)
        return SimpleNamespace(delete_count=result.get("delete_count", 0), primary_keys=[], cost=0)
