# Model catalog

The authoritative, machine-readable source is
[`docs/licensing/model-license-data.json`](../licensing/model-license-data.json) (pinned
revisions, evidence URLs, review status). The app reads it and shows a rights badge
on every engine (**Settings → Models**). This page is generated from that file with the
backend's own classifier (`services.model_licenses.license_category`); regenerate it
after the data changes (command in [MAINTENANCE.md](MAINTENANCE.md)).

> **Default engine notice.** The default `k2-fsa/OmniVoice` weights are
> **CC-BY-NC — non-commercial only**. The app keeps them unloaded until the licence is
> accepted and labels them non-commercial. For commercial work pick an engine from the
> *Commercial use permitted* list (for example KittenTTS, CosyVoice 3, VoxCPM2,
> MOSS-TTS) and check its conditions. The application code is AGPL-3.0; model
> licences apply separately to weights and outputs. This is not legal advice.

## Verified in this handover (real inference, CPU)

| Capability | Engine / model | Licence | Hardware | Result |
|---|---|---|---|---|
| Text-to-speech (preset voices, English) | KittenTTS · `KittenML/kitten-tts-mini-0.8` (ONNX) | Apache-2.0 | 2 vCPU x86-64, 7.8 GB RAM, no GPU | 8.26 s in 15.39 s cold; 8.17 s in 13.70 s warm (**RTF 1.68**); RSS 1.16 GB; 0 clipped samples; works with `HF_HUB_OFFLINE=1` |
| Zero-shot voice cloning (20 langs, 48 kHz) | MOSS-TTS-Nano · `OpenMOSS-Team/MOSS-TTS-Nano` | Apache-2.0 | 2 vCPU x86-64, 7.8 GB RAM, no GPU | 6.08 s in 27.74 s cold; 6.80 s in 16.11 s warm (**RTF 2.37**); RSS 1.55 GB; peak −4.93 dBFS; 0 clipped; 0% WER transcript |
| Transcription | faster-whisper · `Systran/faster-whisper-base` (int8) | MIT | 2 vCPU x86-64, 7.8 GB RAM, no GPU | 8.26 s of audio in 5.32 s (**RTF 0.64**); 0% WER; works with `HF_HUB_OFFLINE=1` |
| Dubbing forced alignment | WhisperX + `wav2vec2_fairseq_base_ls960` | MIT | 2 vCPU x86-64, 7.8 GB RAM, no GPU | Verified on real MP4 upload → 2 timed segments → SRT/VTT export |
| Provenance watermark | AudioSeal generator + detector (16-bit) | MIT (code) | 2 vCPU x86-64, 7.8 GB RAM, no GPU | Confidence 1.0 on raw WAV, finished WAV, 24-bit/48 kHz WAV, FLAC, and MOSS-TTS-Nano 48 kHz clone; 0.992 on MP3 |

Commercial Production Guard (`OMNIVOICE_COMMERCIAL_ONLY=1` / `/api/settings/commercial-mode`)
blocks `noncommercial` (including `k2-fsa/OmniVoice`, `Serveurperso/OmniVoice-GGUF`,
`facebook/nllb-200-distilled-600M`) and `unknown` models at the backend chokepoint
(`model_acceptance.ensure_accepted`) with HTTP 403 (`commercial_guard_blocked`), even if
previously accepted for personal use.

Not benchmarked on physical GPU/Apple Silicon hardware here: NVIDIA CUDA, AMD ROCm, and
Apple Silicon MPS/MLX paths. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Hardware guidance

| Engine family | CPU | NVIDIA CUDA | AMD ROCm | Apple MPS | Typical VRAM |
|---|---|---|---|---|---|
| KittenTTS, Supertonic, sherpa-onnx, Pocket TTS | ✓ real time | — | — | ✓ | none |
| OmniVoice (PyTorch) | slow | ✓ | ✓ | ✓ | ≥ 6 GB |
| OmniVoice / CosyVoice GGUF (audio.cpp, Vulkan) | ✓ | ✓ | ✓ | ✓ | 2–6 GB |
| CosyVoice 3, VoxCPM2, IndexTTS, MOSS-TTS, Qwen3-TTS | very slow | ✓ | partial | partial | 6–16 GB |
| faster-whisper / WhisperX (ASR) | ✓ (small models) | ✓ | — | — | 1–6 GB |
| MLX engines (mlx-audio, mlx-whisper, parakeet-mlx) | — | — | — | ✓ only | unified memory |

Each engine reports `routing_status` (`gpu`, `cpu_only`, `cpu_fallback`, `unavailable`)
for the current host in **Settings → Models**; selection refuses engines that cannot
run on the host.

## Licence classification of catalogued models

### Commercial use permitted (51)

| Model | Engines | Licence |
|---|---|---|
| `audio-cpp/audio.cpp-gguf:dots-tts-soar-q8_0` | audiocpp-dots | apache-2.0 |
| `Systran/faster-whisper-large-v3` | faster-whisper, faster-whisper-isolated, whisperx | mit |
| `mlx-community/whisper-large-v3-mlx` | mlx-whisper | mit |
| `openai/whisper-large-v3` | pytorch-whisper | apache-2.0 |
| `deepdml/faster-whisper-large-v3-turbo-ct2` | faster-whisper, faster-whisper-isolated, whisperx | mit |
| `Systran/faster-distil-whisper-large-v3` | faster-whisper, faster-whisper-isolated, whisperx | mit |
| `Systran/faster-whisper-medium` | faster-whisper, faster-whisper-isolated, whisperx | mit |
| `Systran/faster-whisper-small` | faster-whisper, faster-whisper-isolated, whisperx | mit |
| `Systran/faster-whisper-base` | faster-whisper, faster-whisper-isolated, whisperx | mit |
| `nvidia/parakeet-tdt-0.6b-v3` | nemo-parakeet | cc-by-4.0 |
| `nvidia/parakeet-tdt-0.6b-v2` | nemo-parakeet | cc-by-4.0 |
| `mlx-community/parakeet-tdt-0.6b-v3` | parakeet-mlx | cc-by-4.0 |
| `UsefulSensors/moonshine-base` | moonshine | mit |
| `UsefulSensors/moonshine-tiny` | moonshine | mit |
| `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8` | sherpa-onnx-asr | cc-by-4.0 |
| `csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20` | sherpa-onnx-asr | apache-2.0 |
| `csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en` | sherpa-onnx-asr | apache-2.0 |
| `csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17` | sherpa-onnx-asr | apache-2.0 |
| `csukuangfj/sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23` | sherpa-onnx-asr | apache-2.0 |
| `pyannote/speaker-diarization-3.1` | — | mit |
| `pyannote/segmentation-3.0` | — | mit |
| `pyannote/wespeaker-voxceleb-resnet34-LM` | — | cc-by-4.0 |
| `OpenMOSS-Team/MOSS-TTS-Nano-100M` | moss-tts-nano | apache-2.0 |
| `KittenML/kitten-tts-mini-0.8` | kittentts | apache-2.0 |
| `openbmb/VoxCPM2` | voxcpm2 | apache-2.0 |
| `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` | cosyvoice | apache-2.0 |
| `lj1995/GPT-SoVITS` | gpt-sovits | mit |
| `mlx-community/Kokoro-82M-bf16` | mlx-audio | apache-2.0 |
| `mlx-community/csm-1b-8bit` | mlx-audio | apache-2.0 |
| `mlx-community/VoxCPM2-8bit` | mlx-audio | apache-2.0 |
| `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit` | mlx-audio | apache-2.0 |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-4bit` | mlx-audio | apache-2.0 |
| `mlx-community/Dia-1.6B` | mlx-audio | apache-2.0 |
| `mlx-community/MeloTTS-English-v3-MLX` | mlx-audio | mit |
| `kyutai/pocket-tts` | pockettts | cc-by-4.0 |
| `OpenMOSS-Team/MOSS-TTS-v1.5` | moss-tts-v15 | apache-2.0 |
| `OpenMOSS-Team/MOSS-Audio-Tokenizer` | — | apache-2.0 |
| `rednote-hilab/dots.tts-soar` | dots-tts | apache-2.0 |
| `inclusionAI/Ming-3.0-tts-0.5b` | ming-tts | mit |
| `OpenMOSS-Team/MOSS-SoundEffect-v2.0` | — | apache-2.0 |
| `netease-youdao/Confucius4-TTS` | confucius4-tts | apache-2.0 |
| `facebook/w2v-bert-2.0` | confucius4-tts | mit |
| `funasr/campplus` | confucius4-tts | apache-2.0 |
| `nvidia/bigvgan_v2_22khz_80band_256x` | confucius4-tts | mit |
| `Systran/faster-whisper-tiny` | faster-whisper | mit |
| `Systran/faster-whisper-large-v2` | faster-whisper | mit |
| `openai/whisper-large-v3-turbo` | pytorch-whisper | mit |
| `OpenMOSS-Team/MOSS-TTS-Nano` | moss-tts-nano | apache-2.0 |
| `Lourdle/Fun-CosyVoice3-0.5B-2512-GGUF` | cosyvoice-gguf | apache-2.0 (upstream model-card metadata) |
| `unsloth/Qwen3-1.7B-GGUF` | mobile:llama.cpp | apache-2.0 |
| `ggerganov/whisper.cpp` | whisper-cpp | mit |

### Permitted with conditions (5)

| Model | Engines | Licence |
|---|---|---|
| `Supertone/supertonic-3` | supertonic3 | openrail |
| `csukuangfj/kitten-mini-en-v0_1-fp16` | mobile:sherpa-onnx | apache-2.0; gpl-3.0 |
| `csukuangfj/kokoro-int8-multi-lang-v1_1` | mobile:sherpa-onnx | apache-2.0; gpl-3.0 |
| `csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11` | mobile:sherpa-onnx | OpenRAIL-M; MIT |
| `k2-fsa/ZipVoice` | mobile:sherpa-onnx | Apache-2.0; MIT; GPL-3.0 |

### Unknown / unreviewed (12)

| Model | Engines | Licence |
|---|---|---|
| `audio-cpp/audio.cpp-gguf` | audiocpp | other |
| `mlx-community/whisper-large-v3-turbo` | mlx-whisper | NOASSERTION |
| `mlx-community/whisper-large-v3-turbo-asr-fp16` | mlx-audio | NOASSERTION |
| `mlx-community/whisper-tiny-mlx` | mlx-whisper | NOASSERTION |
| `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` | sherpa-onnx-asr | NOASSERTION |
| `csukuangfj/sherpa-onnx-whisper-tiny` | sherpa-onnx-asr | NOASSERTION |
| `mlx-community/Chatterbox-TTS-4bit` | mlx-audio | NOASSERTION |
| `IndexTeam/IndexTTS-2.5` | indextts2 | other |
| `iic/SenseVoiceSmall` | funasr | NOASSERTION |
| `eustlb/higgs-audio-v2-tokenizer` | omnivoice, omnivoice-subprocess | NOASSERTION |
| `csukuangfj/sherpa-onnx-whisper-base` | mobile:sherpa-onnx | NOASSERTION |
| `csukuangfj/vits-piper-en_US-lessac-medium` | mobile:sherpa-onnx | GPL-3.0; NOASSERTION |

### Non-commercial only (5)

| Model | Engines | Licence |
|---|---|---|
| `k2-fsa/OmniVoice` | omnivoice, omnivoice-subprocess | CC-BY-NC (version unspecified); Higgs Audio 2; Meta Llama 3 |
| `facebook/nllb-200-distilled-600M` | — | CC-BY-NC-4.0 |
| `mlx-community/Llama-OuteTTS-1.0-1B-4bit` | mlx-audio | CC-BY-NC-SA-4.0 AND Llama-3.2 |
| `Serveurperso/OmniVoice-GGUF` | omnivoice-gguf | CC-BY-NC-4.0; Higgs Audio 2; Meta Llama 3 |
| `csukuangfj2/sherpa-onnx-pocket-tts-int8-2026-01-26` | mobile:sherpa-onnx | CC-BY-4.0; non-commercial conversion restriction |
