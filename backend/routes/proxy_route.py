from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
import httpx

router = APIRouter()

@router.get("/stream")
async def proxy_stream(url: str = Query(...)):
    """
    Proxy MJPEG stream từ camera IP (HTTP) qua backend HTTPS.
    Ví dụ: /proxy/stream?url=http://192.168.1.3:4747/mjpegfeed
    """
    async def stream_generator():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("GET", url) as response:
                async for chunk in response.aiter_bytes(chunk_size=4096):
                    yield chunk

    # Lấy content-type từ camera
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.head(url)
            content_type = r.headers.get("content-type", "multipart/x-mixed-replace")
        except Exception:
            content_type = "multipart/x-mixed-replace; boundary=frame"

    return StreamingResponse(
        stream_generator(),
        media_type=content_type,
        headers={
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*",
        }
    )