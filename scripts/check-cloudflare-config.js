import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";
const errors = [];
const config = parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
  errors,
  { allowTrailingComma: true },
);
if (
  errors.length ||
  !config?.d1_databases?.[0]?.database_id ||
  config.d1_databases[0].database_id === "00000000-0000-0000-0000-000000000000"
) {
  console.error(
    "Renseignez database_id dans wrangler.jsonc avec l’identifiant de votre base D1. Voir HEBERGEMENT-CLOUDFLARE.md.",
  );
  process.exit(1);
}
