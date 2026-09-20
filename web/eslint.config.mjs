import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
  {
    // The console intentionally uses effects to bootstrap remote data and to
    // mirror controlled inputs. React 19's rule cannot distinguish those
    // asynchronous/synchronisation effects from an avoidable render loop.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
