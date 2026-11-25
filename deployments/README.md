# Deployment manifests (vendored)

`index.mjs` (loader) and `lighter-devnet.json` (chain 19529) are byte-identical copies of
`lumina-monorepo/deployments/` (monorepo CI checks `deployments/index.mjs` against its copy with
`cmp`). Do not edit them here; copy them again after every manifest or loader change (e.g. when the
deploy scripts fill the addresses and set `status: "deployed"`). The full schema and validation
rules are documented in `lumina-monorepo/deployments/README.md`.

`index.d.mts` is frontend-owned: TypeScript declarations for the loader exports and manifest fields
used by the app.

## Loader exports and signer sets

`index.mjs` exports `loadManifest`, `validateManifest`, `ManifestError`, `SIGNER_SETS`,
`resolveSignerSet`, `ENVIRONMENTS`, `ARCHIVED_ENVIRONMENTS`, `REQUIRED_CONTRACTS`,
`ACL_ROLE_NAMES`, `SCHEMA_VERSION`, `ZERO_ADDRESS`, `toChecksumAddress`, `isChecksumAddress`,
`keccak256Hex`, `hexToBytes`, `bytesToHex`, and `keccak256`.

- `signerSet` (`"live"` or `"harness"`): enforced on every `status: "deployed"` manifest whether
  `strict` is `true` or `false`. `"live"` pins `deployer`, `safe.owners`, `bots.keeper`, and
  `bots.liquidator` to the committed launch keyset; `"harness"` pins them to the Anvil test keyset.
- The app loads the manifest only through `lib/deployments.ts`, which always passes an explicit
  `signerSet` derived from `NEXT_PUBLIC_LUMINA_SIGNER_SET` (`"harness"` only when set to
  `"harness"`, otherwise `"live"`). It never lets the loader fall back to the server-only
  `LUMINA_SIGNER_SET` environment variable.
- `lib/deployments.test.ts` checks that the vendored loader validates the vendored manifest
  (template mode while `status: "template"`, strict once `"deployed"`) and enforces the signer set
  through the app entry point.

## Deployed manifest fields (audit-fixes-v1 F1 / F4 / F6)

- **Core reserves (`markets.core[]`)**: `symbol`, `asset`, `aToken`, `variableDebtToken`,
  `priceSource`, `ltvBps`, `liquidationThresholdBps`, `liquidationBonusBps`,
  `liquidationProtocolFeeBps`, `reserveFactorBps`, `debtCeiling`, `supplyCap`, `borrowCap`,
  `active`, `frozen`, `paused`, `borrowingEnabled`, `flashLoanEnabled`, `optimalUsageRatioBps`,
  `baseVariableBorrowRateBps`, `variableRateSlope1Bps`, `variableRateSlope2Bps`, `seedAmount`.
- **Isolated pairs (`markets.isolated[]`)**: `name`, `pair`, `asset`, `collateral`, `maxLtvBps`,
  `cleanLiquidationFeeBps`, `protocolLiquidationFeeShareBps`, `seedAmount`, `depositLimit`,
  `borrowLimit` (both limits required non-null, positive, `< type(uint256).max`, and
  `depositLimit >= seedAmount` once deployed).
- **ACL (`roles.core.acl`)**: `DEFAULT_ADMIN` `[Executor]`, `POOL_ADMIN` `[Executor]`,
  `RISK_ADMIN` `[Safe, Executor]`, `EMERGENCY_ADMIN` `[Safe]`, and empty `ASSET_LISTING_ADMIN`,
  `FLASH_BORROWER`, `BRIDGE`.
- **Required contracts (`REQUIRED_CONTRACTS`)**: includes `poolDataProvider`,
  `reserveInterestRateStrategy`, and `isolatedRateCalculator` in addition to core/oracle/isolated
  singletons.
