"""Deterministic fictional language provider; never imported by application startup."""

import copy


class FakeLanguage:
    """Synthetic drafts only; no credentials, logging, persistence or client initialization."""
    def __init__(self, output):
        self.output = output
        self.calls = 0
        self.request = None
        self.failure = None
        self.beforeReturn = None

    def generate(self, request):
        self.calls += 1
        self.request = request
        if self.beforeReturn is not None:
            self.beforeReturn()
        if self.failure is not None:
            raise self.failure
        return copy.deepcopy(self.output)
