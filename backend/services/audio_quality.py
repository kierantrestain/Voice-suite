"""Read-only, model-free advisory checks; never a perceptual quality score."""
from pathlib import Path
from typing import Literal

import numpy as np
import soundfile as sf
from pydantic import BaseModel


class AudioWarning(BaseModel):
    kind: Literal['empty', 'silence', 'quiet', 'loud', 'clipping', 'invalid']
    start: float
    end: float


class AudioQuality(BaseModel):
    duration: float
    analyzed_seconds: float
    truncated: bool
    warnings: list[AudioWarning]
    sample_rate: int = 0
    channels: int = 0
    peak_dbfs: float = -120.0
    rms_dbfs: float = -120.0
    dc_offset: float = 0.0
    clipped_samples: int = 0
    silence_ratio: float = 0.0


def analyze_audio(path: str | Path, *, max_seconds: float = 7200) -> AudioQuality:
    """Scan 100ms windows, bounded to two hours and 100 warnings.

    RMS uses the loudest channel, not a phase-cancelling downmix. Relative
    volume checks exclude silence and use the median active-window level.
    One-second silence and 12dB sustained deviations are advisory only.
    """
    levels, clips, invalid = [], [], []
    peak_linear = 0.0
    sum_sq = 0.0
    sum_val = 0.0
    total_samples = 0
    clipped_total = 0
    with sf.SoundFile(path) as source:
        sample_rate = int(source.samplerate)
        channels = int(source.channels)
        duration = len(source) / sample_rate
        if channels > 64 or sample_rate > 768000:
            raise ValueError('Unsupported audio dimensions')
        window = max(1, round(sample_rate * .1))
        limit = min(len(source), int(max(0, min(max_seconds, 7200)) * sample_rate))
        read = 0
        while read < limit:
            data = source.read(min(window, limit - read), dtype='float32', always_2d=True)
            if not len(data):
                break
            read += len(data)
            finite = np.isfinite(data)
            invalid.append(not bool(finite.all()))
            data = np.where(finite, data, 0).astype(np.float64)
            clipped_here = int(np.count_nonzero(np.abs(data) >= .999))
            clipped_total += clipped_here
            clips.append(bool(clipped_here >= 3))
            peak_linear = max(peak_linear, float(np.max(np.abs(data))))
            sum_sq += float(np.sum(data * data))
            sum_val += float(np.sum(data))
            total_samples += int(data.size)
            rms = float(np.sqrt(np.max(np.mean(data * data, axis=0))))
            levels.append(20 * np.log10(max(rms, 1e-12)))
        analyzed = read / sample_rate
        step = window / sample_rate

    warnings = []
    truncated = analyzed < duration
    if not levels:
        return AudioQuality(
            duration=duration,
            analyzed_seconds=analyzed,
            truncated=truncated,
            warnings=[AudioWarning(kind='empty', start=0, end=0)],
            sample_rate=sample_rate,
            channels=channels,
            silence_ratio=1.0,
        )
    values = np.asarray(levels)
    active = values[values > -50]
    baseline = float(np.median(active)) if len(active) else -50
    silence_mask = values <= -50
    checks = [
        ('invalid', np.asarray(invalid), 0),
        ('clipping', np.asarray(clips), 0),
        ('silence', silence_mask, 0 if not len(active) else 1),
        ('quiet', (values > -50) & (values < baseline - 12), .5),
        ('loud', values > baseline + 12, .5),
    ]
    for kind, mask, minimum in checks:
        edges = np.diff(np.concatenate(([False], mask, [False])).astype(int))
        for start, end in zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)):
            begin, finish = start * step, min(end * step, analyzed)
            if finish - begin + 1e-8 < minimum:
                continue
            warnings.append(AudioWarning(kind=kind, start=round(begin, 3), end=round(finish, 3)))
    # Sort the full set first so the cap keeps the earliest warnings on the
    # timeline rather than whichever check happened to run first.
    warnings.sort(key=lambda item: (item.start, item.kind))
    if len(warnings) > 100:
        truncated = True
        del warnings[100:]
    rms_linear = float(np.sqrt(sum_sq / max(1, total_samples)))
    return AudioQuality(
        duration=duration,
        analyzed_seconds=analyzed,
        truncated=truncated,
        warnings=warnings,
        sample_rate=sample_rate,
        channels=channels,
        peak_dbfs=round(float(20 * np.log10(max(peak_linear, 1e-6))), 2),
        rms_dbfs=round(float(20 * np.log10(max(rms_linear, 1e-6))), 2),
        dc_offset=round(float(sum_val / max(1, total_samples)), 6),
        clipped_samples=clipped_total,
        silence_ratio=round(float(np.mean(silence_mask)), 4),
    )
