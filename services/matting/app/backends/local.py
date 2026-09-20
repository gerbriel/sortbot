"""Local backend — BiRefNet in-process.

NOT INSTALLED BY DEFAULT. torch + transformers + timm is ~2.5 GB of wheels and
several GB of RAM; the replicate backend is ~$0.0017 an image and needs neither.
This exists so the pipeline is not hostage to one vendor: the same alpha, the
same composite, the same columns, with `pip install -e '.[local]'` and one env
var. Everything above this file is already written against `Matter`.

EVERY TORCH IMPORT IS INSIDE A FUNCTION. If they were at module scope, a
service running MATTING_BACKEND=replicate would fail to start the moment
anything imported the backends package — which app/main.py does, to pick a
backend. The cost of the discipline is a slightly odd-looking file; the benefit
is that the default image genuinely does not need torch.

WEIGHTS: ZhengPeng7/BiRefNet (1024²) and ZhengPeng7/BiRefNet_HR (2048²), both
MIT-licensed code and weights. They load through `transformers` with
`trust_remote_code=True` — BiRefNet ships its architecture as model code on the
Hub rather than as a transformers class. That flag executes code from the Hub,
so the model id is pinned in config (LOCAL_MODEL / LOCAL_HR_MODEL) and should
be a repo you have read, not a value a user can set.
"""

from __future__ import annotations

import asyncio
import logging

import numpy as np

from ..compose import decode_image_rgb
from ..config import Settings
from .base import BackendUnavailable, refine_alpha

log = logging.getLogger("matting.local")

# BiRefNet's published preprocessing. Not a guess — it is ImageNet
# normalisation, which is what the checkpoints were trained with; changing it
# does not error, it just quietly produces worse mattes.
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)


def _require_torch():
    try:
        import torch  # noqa: F401
        from transformers import AutoModelForImageSegmentation  # noqa: F401
    except ImportError as exc:
        raise BackendUnavailable(
            "MATTING_BACKEND=local needs the optional extra: pip install -e '.[local]'"
        ) from exc
    import torch

    return torch


def _pick_device(torch):
    """CUDA, then Apple MPS, then CPU.

    MPS is worth the branch: the founder's machine is an M-series Mac, and a
    1024² BiRefNet pass is ~1 s on MPS against ~15 s on CPU — the difference
    between "run the batch over lunch" and "run it overnight".
    """
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class LocalMatter:
    """Matter backed by an in-process BiRefNet."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._torch = _require_torch()
        self._device = _pick_device(self._torch)
        self._models: dict[int, object] = {}
        self._lock = asyncio.Lock()
        self._resolution = 1024
        log.info("local backend on device=%s", self._device)

    @property
    def tag(self) -> str:
        return f"local:BiRefNet@{self._resolution}"

    def _model_id(self, resolution: int) -> str:
        return self._s.local_hr_model if resolution >= 2048 else self._s.local_model

    def _load(self, resolution: int):
        from transformers import AutoModelForImageSegmentation

        torch = self._torch
        model = AutoModelForImageSegmentation.from_pretrained(
            self._model_id(resolution), trust_remote_code=True
        )
        model.to(self._device)
        model.eval()
        if self._device.type == "cuda":
            model.half()
        torch.set_grad_enabled(False)
        return model

    async def _get_model(self, resolution: int):
        async with self._lock:
            if resolution not in self._models:
                # from_pretrained downloads and blocks; keep the loop alive.
                self._models[resolution] = await asyncio.to_thread(self._load, resolution)
            return self._models[resolution]

    def _infer(self, model, rgb: np.ndarray, resolution: int) -> np.ndarray:
        import cv2

        torch = self._torch
        x = cv2.resize(rgb, (resolution, resolution), interpolation=cv2.INTER_CUBIC)
        arr = x.astype(np.float32) / 255.0
        arr = (arr - np.asarray(_MEAN, dtype=np.float32)) / np.asarray(_STD, dtype=np.float32)
        t = torch.from_numpy(arr.transpose(2, 0, 1)).unsqueeze(0).to(self._device)
        if self._device.type == "cuda":
            t = t.half()

        with torch.no_grad():
            out = model(t)
        # BiRefNet returns a list of progressively refined maps; the LAST one is
        # the final prediction. Taking [0] here is the classic way to ship a
        # visibly worse matte with no error anywhere.
        pred = out[-1] if isinstance(out, (list, tuple)) else out
        if isinstance(pred, (list, tuple)):
            pred = pred[-1]
        pred = pred.sigmoid().float().squeeze().cpu().numpy()
        return np.clip(pred.astype(np.float32), 0.0, 1.0)

    async def mat(self, image_bytes: bytes, want_resolution: int) -> np.ndarray:
        resolution = 2048 if want_resolution and want_resolution >= 2048 else 1024
        self._resolution = resolution
        rgb = decode_image_rgb(image_bytes)
        model = await self._get_model(resolution)
        alpha = await asyncio.to_thread(self._infer, model, rgb, resolution)
        return refine_alpha(alpha, rgb)
