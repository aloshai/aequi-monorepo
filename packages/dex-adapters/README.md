# @aequi/dex-adapters

Default DEX adapter implementations for Aequi aggregator.

## Included Adapters

- **Uniswap V2** - Uniswap V2 protocol adapter
- **Uniswap V3** - Uniswap V3 protocol adapter with Quoter integration
- **PancakeSwap V2** - PancakeSwap V2 protocol adapter
- **PancakeSwap V3** - PancakeSwap V3 protocol adapter with Quoter integration

## Usage

```typescript
import { registerDefaultAdapters } from '@aequi/dex-adapters'
import { dexRegistry } from '@aequi/pricing'

// Register all default adapters
registerDefaultAdapters(dexRegistry)

// Or register individually
import { UniswapV2Adapter, PancakeV3Adapter } from '@aequi/dex-adapters'

dexRegistry.register(new UniswapV2Adapter())
dexRegistry.register(new PancakeV3Adapter())
```

## Creating Custom Adapters

To create your own DEX adapter, implement the `IDexAdapter` interface from `@aequi/pricing`:

```typescript
import { BaseDexAdapter, type V2QuoteParams } from '@aequi/pricing'
import type { PriceQuote } from '@aequi/core'

export class MyDexV2Adapter extends BaseDexAdapter {
  readonly protocol = 'mydex'
  readonly version = 'v2' as const
  
  async computeV2Quote(params: V2QuoteParams): Promise<PriceQuote | null> {
    // Your implementation
  }
}
```

Then register it:

```typescript
import { dexRegistry } from '@aequi/pricing'
import { MyDexV2Adapter } from './my-dex-adapter'

dexRegistry.register(new MyDexV2Adapter())
```
