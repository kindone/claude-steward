"""
display.py — Notebook-Pro rich output helper.

Usage:
    from display import vega, html, image, table

Each function prints an NBOUT sentinel that the notebook server routes
to the appropriate rich renderer in the browser.

Sentinel format: NBOUT:<kind>:<base64-encoded-payload>
"""
import base64
import json as _json
import pathlib


def _emit(kind: str, data: bytes) -> None:
    payload = base64.b64encode(data).decode('ascii')
    print(f'NBOUT:{kind}:{payload}', flush=True)


def vega(spec: dict) -> None:
    """Render a Vega-Lite spec dict as an interactive chart."""
    _emit('vega', _json.dumps(spec).encode('utf-8'))


def html(content: str) -> None:
    """Render an HTML string in a sandboxed iframe."""
    _emit('html', content.encode('utf-8'))


def table(rows: list) -> None:
    """Render a list-of-dicts as a sortable table."""
    _emit('table', _json.dumps(rows).encode('utf-8'))


def image(source) -> None:
    """
    Render an image inline.

    source: file path (str / pathlib.Path), raw bytes, or a file-like object.
    SVG content is routed to the html renderer (data URIs for SVG are unreliable).
    """
    if isinstance(source, (str, pathlib.Path)):
        data = pathlib.Path(source).read_bytes()
    elif isinstance(source, (bytes, bytearray)):
        data = bytes(source)
    else:
        # file-like object
        data = source.read()

    stripped = data.lstrip()
    if stripped[:4] == b'<svg' or stripped[:5] == b'<?xml':
        # SVG → html renderer handles it cleanly
        _emit('html', data)
    else:
        _emit('image', data)
