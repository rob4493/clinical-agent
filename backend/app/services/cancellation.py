"""Request-local cooperative cancellation; never retain case content or provider state."""

from contextlib import contextmanager
from contextvars import ContextVar
from threading import Event

ActiveCancellation = ContextVar("ActiveCancellation", default=None)


class RequestCancelled(BaseException):
    """Control flow only; must bypass generic provider and clinical fallback handlers."""


def cancellationEvent():
    return ActiveCancellation.get()


def checkCancelled():
    signal = cancellationEvent()
    if signal is not None and signal.is_set():
        raise RequestCancelled()


@contextmanager
def cancellationScope(signal: Event):
    token = ActiveCancellation.set(signal)
    try:
        checkCancelled()
        yield
        checkCancelled()
    finally:
        ActiveCancellation.reset(token)
