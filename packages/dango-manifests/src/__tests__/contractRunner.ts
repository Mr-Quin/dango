import {
  type ManifestInputs,
  ManifestRunner,
  type ManifestRunnerOptions,
  type RunOptions,
  zCommentRow,
  zEpisodeRow,
  zManifest,
  zParseUrlOutput,
  zSearchRow,
  zSeasonRow,
} from '@mr-quin/dango'

interface Parser {
  safeParse(value: unknown): {
    success: boolean
    error?: { message: string }
  }
}

function assertRows(pipeline: string, row: Parser, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error(`${pipeline} output is not an array`)
  }
  for (const [index, item] of value.entries()) {
    assertValue(`${pipeline}[${index}]`, row, item)
  }
}

function assertValue(label: string, schema: Parser, value: unknown): void {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(
      `${label} violates the output contract: ${result.error?.message}`
    )
  }
}

/**
 * A ManifestRunner that checks every pipeline result against the row schemas
 * the engine exports, so a fixture-driven test fails when a manifest emits a
 * shape a host would reject. Use `createContractRunner` instead of
 * `new ManifestRunner` in manifest tests.
 */
export class ContractRunner extends ManifestRunner {
  override async runSearch<T = unknown>(
    inputs: ManifestInputs,
    opts?: RunOptions
  ): Promise<T> {
    const result = await super.runSearch<T>(inputs, opts)
    assertRows('search', zSearchRow, result)
    return result
  }

  override async runEpisodes<T = unknown>(
    inputs: ManifestInputs,
    opts?: RunOptions
  ): Promise<T> {
    const result = await super.runEpisodes<T>(inputs, opts)
    assertRows('episodes', zEpisodeRow, result)
    return result
  }

  override async runDanmaku<T = unknown>(
    inputs: ManifestInputs,
    opts?: RunOptions
  ): Promise<T> {
    const result = await super.runDanmaku<T>(inputs, opts)
    assertRows('danmaku', zCommentRow, result)
    return result
  }

  override async runSeason<T = unknown>(
    inputs: ManifestInputs,
    opts?: RunOptions
  ): Promise<T | null> {
    const result = await super.runSeason<T>(inputs, opts)
    if (result !== null) {
      assertValue('season', zSeasonRow, result)
    }
    return result
  }

  override async runParseUrl<T = unknown>(
    url: string,
    extraInputs: ManifestInputs = {},
    opts?: RunOptions
  ): Promise<T | null> {
    const result = await super.runParseUrl<T>(url, extraInputs, opts)
    if (result !== null) {
      assertValue('parseUrl', zParseUrlOutput, result)
    }
    return result
  }
}

export function createContractRunner(
  manifestJson: unknown,
  options?: ManifestRunnerOptions
): ContractRunner {
  return new ContractRunner(zManifest.parse(manifestJson), options)
}
