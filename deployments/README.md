# Deployment manifests (vendored)

`index.mjs` (loader) and `lighter-devnet.json` (chain 19529) are byte-identical copies of
`lumina-monorepo/deployments/` on branch `lighter-devnet-v1`. Do not edit them here; copy them again
after every manifest change (e.g. when the deploy scripts fill the addresses and set
`status: "deployed"`). The schema and validation rules are documented in the monorepo's
`deployments/README.md`.

`index.d.mts` is the only frontend-owned file: type declarations for the loader exports the app uses.

The app loads the manifest only through the loader (`lib/deployments.ts`), and `lib/deployments.test.ts`
checks that the vendored loader validates the vendored manifest (template mode while
`status: "template"`, strict once it is `"deployed"`).
