"""Local smoke-test server: block and count every non-loopback connection attempt."""

import ipaddress
import json
import socket
import os
from pathlib import Path
from urllib.parse import urlsplit

Attempts = dict(socket=0, dns=0, http=0, grpc=0, milvus=0, model=0)
Report = Path(__file__).parents[2] / "frontend/screenshots" / ("demoDisabledBackendGuard.json" if os.environ.get("CLINICAL_DEMO_MODE") == "false" else "demoBackendGuard.json")


def saveReport():
    Report.write_text(json.dumps(Attempts, sort_keys=True) + "\n", encoding="utf-8")


def localHost(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def reject(category):
    Attempts[category] += 1
    saveReport()
    raise RuntimeError("Non-local connection prohibited.")


def guardSocket(original):
    def connect(connection, address, *arguments, **options):
        if not isinstance(address, tuple) or not localHost(address[0]):
            reject("socket")
        return original(connection, address, *arguments, **options)
    return connect


for method in ["connect", "connect_ex", "sendto"]:
    setattr(socket.socket, method, guardSocket(getattr(socket.socket, method)))


def guardDns(original):
    def resolve(host, *arguments, **options):
        if not localHost(host):
            reject("dns")
        return original(host, *arguments, **options)
    return resolve


for method in ["getaddrinfo", "gethostbyname", "gethostbyname_ex", "gethostbyaddr"]:
    setattr(socket, method, guardDns(getattr(socket, method)))


def block(category):
    def blocked(*arguments, **options):
        reject(category)
    return blocked


import grpc
from pymilvus import MilvusClient, connections
from ibm_watsonx_ai import APIClient
from ibm_watsonx_ai.foundation_models import ModelInference

for owner in [grpc, grpc.aio]:
    for method in ["secure_channel", "insecure_channel"]:
        setattr(owner, method, block("grpc"))
MilvusClient.__init__ = block("milvus")
connections.connect = block("milvus")
APIClient.__init__ = block("model")
ModelInference.__init__ = block("model")

import httpx
import requests
import urllib.request


def guardHttp(original):
    def send(transport, request, *arguments, **options):
        if not localHost(request.url.host):
            reject("http")
        return original(transport, request, *arguments, **options)
    return send


httpx.HTTPTransport.handle_request = guardHttp(httpx.HTTPTransport.handle_request)
OriginalAsync = httpx.AsyncHTTPTransport.handle_async_request


async def sendAsync(transport, request):
    if not localHost(request.url.host):
        reject("http")
    return await OriginalAsync(transport, request)


httpx.AsyncHTTPTransport.handle_async_request = sendAsync
OriginalRequests = requests.Session.request


def sendRequest(session, method, url, *arguments, **options):
    if not localHost(urlsplit(url).hostname):
        reject("http")
    return OriginalRequests(session, method, url, *arguments, **options)


requests.Session.request = sendRequest
OriginalOpen = urllib.request.urlopen


def openUrl(url, *arguments, **options):
    address = url.full_url if isinstance(url, urllib.request.Request) else url
    if not localHost(urlsplit(address).hostname):
        reject("http")
    return OriginalOpen(url, *arguments, **options)


urllib.request.urlopen = openUrl

if __name__ == "__main__":
    import uvicorn
    # No access logs: fixed local smoke checks cannot log case bodies or provider data.
    saveReport()
    try:
        port = 8001 if os.environ.get("CLINICAL_DEMO_MODE") == "false" else 8000
        uvicorn.run("backend.app.main:app", host="127.0.0.1", port=port, access_log=False, log_level="warning")
    finally:
        saveReport()
