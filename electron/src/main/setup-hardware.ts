import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { primeTorchVariantProbe, resolveTorchVariant } from './runtime-project';

export interface SetupHardware {
  gpu?: string;
  build: 'metal' | 'cuda' | 'rocm' | 'cpu';
  reason?: 'no_nvidia' | 'windows_arm' | 'explicit';
}

export interface SetupHardwareProbe {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: string;
  hasNvidia?: () => boolean;
  cpuModel?: () => string | undefined;
  /** Resolves the raw `nvidia-smi` name output, or rejects. */
  nvidiaSmi?: () => Promise<string>;
}

const NAME_MAX = 60;

export function sanitizeGpuName(raw: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex
  const first = raw
    ?.split(/\r?\n/)
    .find((line) => line.trim())
    ?.replace(/[\u0000-\u001f]/g, '');
  const name = first?.trim().replace(/\s+/g, ' ');
  return name ? name.slice(0, NAME_MAX) : undefined;
}

function queryNvidiaSmi(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name', '--format=csv,noheader'],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(String(stdout))),
    );
  });
}

/** What the runtime install will pick for this host, for the setup screen. Never throws. */
export async function detectSetupHardware(
  probe: SetupHardwareProbe = {},
): Promise<SetupHardware | undefined> {
  try {
    const env = probe.env ?? process.env;
    const platform = probe.platform ?? process.platform;
    const arch = probe.arch ?? process.arch;
    if (platform === 'darwin') {
      if (arch !== 'arm64') return undefined;
      const gpu = sanitizeGpuName(
        (probe.cpuModel ?? (() => cpus()[0]?.model || 'Apple Silicon (Metal/MPS)'))(),
      );
      return { ...(gpu ? { gpu } : {}), build: 'metal' };
    }
    if (platform !== 'linux' && platform !== 'win32') return undefined;
    if (!probe.hasNvidia) await primeTorchVariantProbe(platform, arch);
    const choice = resolveTorchVariant(env, platform, arch, probe.hasNvidia);
    if (choice.variant === 'rocm') return { build: 'rocm' };
    if (choice.variant === 'cpu') {
      const reason = choice.explicit
        ? 'explicit'
        : platform === 'win32' && arch === 'arm64'
          ? 'windows_arm'
          : 'no_nvidia';
      return { build: 'cpu', reason };
    }
    if (platform === 'linux' && arch !== 'x64') return undefined;
    let gpu: string | undefined;
    try {
      gpu = sanitizeGpuName(await (probe.nvidiaSmi ?? queryNvidiaSmi)());
    } catch {
      gpu = undefined;
    }
    return { ...(gpu ? { gpu } : {}), build: 'cuda' };
  } catch {
    return undefined;
  }
}

export interface HardwareAccelerationStatus {
  accelerated: boolean;
  backend: 'mps' | 'cuda' | 'rocm' | 'cpu';
  build: 'metal' | 'cuda' | 'rocm' | 'cpu';
  gpu?: string;
  reason?: 'no_nvidia' | 'windows_arm' | 'explicit' | 'intel_mac' | 'unsupported_platform';
  explanation: string;
}

/**
 * Human-readable hardware acceleration and CPU-fallback explanation for a detected host.
 * Clearly identifies Apple Silicon Metal (MPS) acceleration on darwin/arm64 and explains
 * CPU fallback on Intel Mac, Windows on ARM, explicit CPU override, or GPU-less hosts.
 */
export function explainSetupHardware(
  hardware: SetupHardware | undefined,
  probe: Pick<SetupHardwareProbe, 'platform' | 'arch'> = {},
): HardwareAccelerationStatus {
  const platform = probe.platform ?? process.platform;
  const arch = probe.arch ?? process.arch;

  if (hardware?.build === 'metal') {
    const label = hardware.gpu ?? 'Apple Silicon';
    return {
      accelerated: true,
      backend: 'mps',
      build: 'metal',
      ...(hardware.gpu ? { gpu: hardware.gpu } : {}),
      explanation: `Apple Silicon Metal (MPS) acceleration active on ${label}.`,
    };
  }

  if (hardware?.build === 'cuda') {
    return {
      accelerated: true,
      backend: 'cuda',
      build: 'cuda',
      ...(hardware.gpu ? { gpu: hardware.gpu } : {}),
      explanation: hardware.gpu
        ? `NVIDIA CUDA GPU acceleration active on ${hardware.gpu}.`
        : 'NVIDIA CUDA GPU acceleration active.',
    };
  }

  if (hardware?.build === 'rocm') {
    return {
      accelerated: true,
      backend: 'rocm',
      build: 'rocm',
      ...(hardware.gpu ? { gpu: hardware.gpu } : {}),
      explanation: 'AMD ROCm GPU acceleration active.',
    };
  }

  if (platform === 'darwin' && arch !== 'arm64') {
    return {
      accelerated: false,
      backend: 'cpu',
      build: 'cpu',
      reason: 'intel_mac',
      explanation:
        'CPU fallback on Intel Mac (x86_64): Apple Silicon Metal (MPS) acceleration requires an arm64 Mac.',
    };
  }

  if (hardware?.build === 'cpu') {
    const reason = hardware.reason ?? 'no_nvidia';
    if (reason === 'explicit') {
      return {
        accelerated: false,
        backend: 'cpu',
        build: 'cpu',
        reason,
        explanation:
          'CPU fallback active: compute build was explicitly pinned to CPU via OMNIVOICE_TORCH_VARIANT=cpu.',
      };
    }
    if (reason === 'windows_arm') {
      return {
        accelerated: false,
        backend: 'cpu',
        build: 'cpu',
        reason,
        explanation: 'CPU fallback on Windows on ARM: local PyTorch runtime executes on CPU.',
      };
    }
    return {
      accelerated: false,
      backend: 'cpu',
      build: 'cpu',
      reason,
      explanation:
        'CPU fallback active: no compatible NVIDIA CUDA, AMD ROCm, or Apple Silicon Metal (MPS) accelerator detected.',
    };
  }

  return {
    accelerated: false,
    backend: 'cpu',
    build: 'cpu',
    reason: 'unsupported_platform',
    explanation: `CPU fallback on ${platform}/${arch}: no supported hardware accelerator detected.`,
  };
}

export async function detectHardwareAccelerationStatus(
  probe: SetupHardwareProbe = {},
): Promise<HardwareAccelerationStatus> {
  const hardware = await detectSetupHardware(probe);
  return explainSetupHardware(hardware, probe);
}

