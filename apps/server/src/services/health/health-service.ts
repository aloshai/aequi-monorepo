import type { FastifyReply, FastifyRequest } from 'fastify';
import { CHAIN_CONFIGS, SUPPORTED_CHAINS } from '../../config/chains';
import { appConfig } from '../../config/app-config';
import type { ChainConfig } from '../../types';
import { getPublicClient } from '../../utils/clients';

export interface HealthCheckResult {
  status: 'ok' | 'degraded' | 'error';
  timestamp: number;
  uptime: number;
  version: string;
  chains: {
    [chainKey: string]: {
      configured: boolean;
      rpcAvailable: boolean;
      blockNumber?: string;
      latencyMs?: number;
    };
  };
}

const RPC_CONFIGURED: Record<string, boolean> = {
  ethereum: appConfig.rpc.ethereum.length > 0,
  bsc: appConfig.rpc.bsc.length > 0,
  incentiv: appConfig.rpc.incentiv.length > 0,
}

export class HealthService {
  private startTime: number;
  private version: string;

  constructor() {
    this.startTime = Date.now();
    this.version = process.env.npm_package_version || '0.0.1';
  }

  async check(): Promise<HealthCheckResult> {
    const timestamp = Date.now();
    const uptime = Math.floor((timestamp - this.startTime) / 1000);

    const chainStatuses: HealthCheckResult['chains'] = {};

    const checks = SUPPORTED_CHAINS.map(async (chainKey) => {
      const chain = CHAIN_CONFIGS[chainKey];
      if (!chain || !RPC_CONFIGURED[chainKey]) {
        chainStatuses[chainKey] = { configured: false, rpcAvailable: false };
        return;
      }

      try {
        const result = await Promise.race([
          this.checkChainRpc(chain),
          new Promise<{ available: boolean; blockNumber?: string; latencyMs?: number }>((resolve) =>
            setTimeout(() => resolve({ available: false, latencyMs: 5000 }), 5000)
          ),
        ]);
        chainStatuses[chainKey] = {
          configured: true,
          rpcAvailable: result.available,
          blockNumber: result.blockNumber,
          latencyMs: result.latencyMs,
        };
      } catch {
        chainStatuses[chainKey] = { configured: true, rpcAvailable: false };
      }
    });

    await Promise.all(checks);

    const configured = Object.values(chainStatuses).filter((s) => s.configured);
    const allAvailable = configured.length > 0 && configured.every((s) => s.rpcAvailable);
    const someAvailable = configured.some((s) => s.rpcAvailable);

    let status: HealthCheckResult['status'] = 'ok';
    if (!someAvailable) {
      status = 'error';
    } else if (!allAvailable) {
      status = 'degraded';
    }

    return { status, timestamp, uptime, version: this.version, chains: chainStatuses };
  }

  private async checkChainRpc(chain: ChainConfig): Promise<{
    available: boolean;
    blockNumber?: string;
    latencyMs?: number;
  }> {
    const startTime = Date.now();
    try {
      const client = await getPublicClient(chain);
      const blockNumber = await client.getBlockNumber();
      return { available: true, blockNumber: blockNumber.toString(), latencyMs: Date.now() - startTime };
    } catch {
      return { available: false, latencyMs: Date.now() - startTime };
    }
  }

  async handleHealthCheck(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await this.check();
    reply.status(result.status === 'error' ? 503 : 200).send(result);
  }

  async handleLivenessCheck(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.status(200).send({ status: 'ok' });
  }

  async handleReadinessCheck(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const result = await this.check();
    if (result.status === 'error') {
      reply.status(503).send({ status: 'not_ready', reason: 'No RPC endpoints available' });
    } else {
      reply.status(200).send({ status: 'ready' });
    }
  }
}
