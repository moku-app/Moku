{ lib, stdenv, nodejs_22, pnpm, pnpmConfigHook, fetchPnpmDeps, version, src }:

stdenv.mkDerivation {
  pname = "moku-frontend";
  inherit version src;

  nativeBuildInputs = [ nodejs_22 pnpm pnpmConfigHook ];

  pnpmDeps = fetchPnpmDeps {
    pname = "moku-frontend";
    inherit version src;
    fetcherVersion = 1;
    hash = "sha256-eRuSSRhNmJ09mp/uhbG+NFeiOZ5dTOdJ94OwdP6IkN0=";
  };

  buildPhase = "pnpm build";
  installPhase = "cp -r dist $out";
}
