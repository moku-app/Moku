{
  description = "Moku — manga reader frontend for Suwayomi";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    crane.url       = "github:ipetkov/crane";
    rust-overlay = {
      url    = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, crane, rust-overlay, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" ];

      perSystem = { system, lib, ... }:
        let
          version = "0.9.1";

          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };

          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" "rust-analyzer" ];
          };

          craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

          runtimeLibs = with pkgs; [
            webkitgtk_4_1
            gtk3
            glib
            cairo
            pango
            atk
            gdk-pixbuf
            libsoup_3
            openssl
            dbus
            libappindicator-gtk3
            gsettings-desktop-schemas
          ];

          frontendSrc = lib.cleanSourceWith {
            src = ./.;
            filter = path: type:
              let base = builtins.baseNameOf path;
              in
              (lib.hasInfix "/src" path)
              || base == "index.html"
              || base == "package.json"
              || base == "pnpm-lock.yaml"
              || base == "tsconfig.json"
              || base == "vite.config.ts";
          };

          frontend = pkgs.stdenv.mkDerivation {
            pname   = "moku-frontend";
            inherit version;
            src     = frontendSrc;

            nativeBuildInputs = with pkgs; [ nodejs_22 pnpm pnpmConfigHook ];

            pnpmDeps = pkgs.fetchPnpmDeps {
              pname          = "moku-frontend";
              inherit version;
              src            = frontendSrc;
              fetcherVersion = 1;
              hash           = "sha256-nlhm3NYn4x+JlKcCgj1lAX43muB3QRKGDzaxfQNfJwc=";
            };

            buildPhase   = "pnpm build";
            installPhase = "cp -r dist $out";
          };

          cargoSrc = lib.cleanSourceWith {
            src    = ./src-tauri;
            filter = path: type:
              (craneLib.filterCargoSources path type)
              || (lib.hasInfix "/icons/"        path)
              || (lib.hasInfix "/capabilities/" path)
              || (builtins.baseNameOf path == "tauri.conf.json");
          };

          commonArgs = {
            src        = cargoSrc;
            cargoToml  = ./src-tauri/Cargo.toml;
            cargoLock  = ./src-tauri/Cargo.lock;
            strictDeps = true;
            buildInputs      = runtimeLibs;
            nativeBuildInputs = with pkgs; [ pkg-config wrapGAppsHook3 ];
            preBuild = ''
              cp -r ${frontend} ../dist
            '';
          };

          cargoArtifacts = craneLib.buildDepsOnly commonArgs;

          moku = craneLib.buildPackage (commonArgs // {
            inherit cargoArtifacts;
            meta.mainProgram = "moku";
            postInstall = ''
              mkdir -p "$out/share/applications"
              cat > "$out/share/applications/moku.desktop" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Moku
Comment=Manga reader frontend for Suwayomi
Exec=$out/bin/moku
Icon=moku
Terminal=false
Categories=Graphics;Viewer;
Keywords=manga;comic;reader;suwayomi;
StartupWMClass=moku
EOF

              for size in 32x32 128x128 256x256 512x512; do
                src="icons/$size.png"
                [ -f "$src" ] && install -Dm644 "$src" \
                  "$out/share/icons/hicolor/$size/apps/moku.png"
              done

              for size in 128x128 256x256; do
                src="icons/''${size}@2x.png"
                [ -f "$src" ] && install -Dm644 "$src" \
                  "$out/share/icons/hicolor/''${size}@2/apps/moku.png"
              done

              install -Dm644 "${./src/assets/moku-icon.svg}" \
                "$out/share/icons/hicolor/scalable/apps/moku.svg"

              wrapProgram $out/bin/moku \
                --prefix XDG_DATA_DIRS : "${lib.makeSearchPath "share/gsettings-schemas" [
                  pkgs.gsettings-desktop-schemas
                  pkgs.gtk3
                ]}" \
                --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath runtimeLibs}" \
                --prefix PATH : "${lib.makeBinPath [ pkgs.suwayomi-server ]}" \
                --set GDK_BACKEND wayland \
                --set WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS 1
            '';
          });

          bumpScript = pkgs.writeShellApplication {
            name = "moku-bump";
            runtimeInputs = with pkgs; [
              gnused coreutils git rustToolchain
              nodejs_22 pnpm
              (python3.withPackages (ps: [ ps.aiohttp ps.tomlkit ]))
            ];
            text = ''
              [[ $# -lt 1 ]] && { echo "Usage: nix run .#bump -- <version>"; exit 1; }
              VERSION="$1"
              REPO="$(git rev-parse --show-toplevel)"

              echo "── Bumping version fields to $VERSION ──"
              sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" \
                "$REPO/src-tauri/tauri.conf.json"
              sed -i "0,/^version = \"[^\"]*\"/s//version = \"$VERSION\"/" \
                "$REPO/src-tauri/Cargo.toml"
              sed -i "s/version = \"[^\"]*\";/version = \"$VERSION\";/g" \
                "$REPO/flake.nix"
              sed -i "s/^pkgver=.*/pkgver=$VERSION/" "$REPO/PKGBUILD"
              sed -i "s/^pkgrel=.*/pkgrel=1/"        "$REPO/PKGBUILD"
              echo "Done"

              echo "── Regenerating Cargo.lock ──"
              (cd "$REPO/src-tauri" && cargo generate-lockfile)
              echo "Done"

              echo "── Building frontend ──"
              cd "$REPO"
              pnpm install --frozen-lockfile
              pnpm build
              echo "Done"

              echo "── Repacking frontend-dist.tar.gz ──"
              tar -czf "$REPO/packaging/frontend-dist.tar.gz" -C "$REPO" dist
              FRONTEND_SHA=$(sha256sum "$REPO/packaging/frontend-dist.tar.gz" | awk '{print $1}')
              echo "sha256: $FRONTEND_SHA"

              echo "── Regenerating cargo-sources.json ──"
              python3 "$REPO/packaging/flatpak-cargo-generator.py" \
                "$REPO/src-tauri/Cargo.lock" \
                -o "$REPO/packaging/cargo-sources.json"
              echo "Done"

              echo "── Patching flatpak manifest ──"
              MANIFEST="$REPO/io.github.moku_project.Moku.yml"
              sed -i "s/tag: v[^[:space:]]*/tag: v$VERSION/" "$MANIFEST"
              python3 - "$MANIFEST" "$FRONTEND_SHA" <<'PYEOF'
              import re, sys
              path, sha = sys.argv[1], sys.argv[2]
              text = open(path).read()
              updated, n = re.subn(
                r'(path:\s*packaging/frontend-dist\.tar\.gz\s*\n\s*sha256:\s*)[0-9a-f]+',
                r'\g<1>' + sha, text)
              if n == 0:
                  sys.exit("ERROR: could not find frontend-dist sha256 in manifest")
              open(path, 'w').write(updated)
              PYEOF
              echo "Done"

              echo ""
              echo "Bumped to v$VERSION — commit, tag, push, then: nix run .#post-tag-bump -- $VERSION"
            '';
          };

          postTagBumpScript = pkgs.writeShellApplication {
            name = "moku-post-tag-bump";
            runtimeInputs = with pkgs; [ gnused coreutils git curl ];
            text = ''
              [[ $# -lt 1 ]] && { echo "Usage: nix run .#post-tag-bump -- <version>"; exit 1; }
              VERSION="$1"
              REPO="$(git rev-parse --show-toplevel)"
              MANIFEST="$REPO/io.github.moku_project.Moku.yml"
              PKGBUILD="$REPO/PKGBUILD"

              echo "── Resolving commit for v$VERSION ──"
              COMMIT=$(git ls-remote https://github.com/moku-project/Moku.git "refs/tags/v$VERSION" \
                | awk '{print $1}')
              [[ -z "$COMMIT" ]] && { echo "ERROR: tag v$VERSION not found on remote"; exit 1; }
              echo "commit: $COMMIT"
              sed -i "s/commit: [0-9a-f]\{40\}/commit: $COMMIT/" "$MANIFEST"
              echo "Done"

              echo "── Fetching PKGBUILD tarball sha256 ──"
              TARBALL_URL="https://github.com/moku-project/Moku/archive/refs/tags/v$VERSION.tar.gz"
              TARBALL_SHA=$(curl -fsSL "$TARBALL_URL" | sha256sum | awk '{print $1}')
              sed -i "/sha256sums=/,/)/{ 0,/'/s/'[^']*'/'$TARBALL_SHA'/ }" "$PKGBUILD"
              grep -q "$TARBALL_SHA" "$PKGBUILD" \
                || { echo "ERROR: PKGBUILD sha256 replacement failed"; exit 1; }
              echo "Done"

              echo ""
              echo "post-tag-bump complete for v$VERSION"
            '';
          };

          flatpakScript = pkgs.writeShellApplication {
            name = "moku-flatpak";
            runtimeInputs = with pkgs; [ coreutils git appstream flatpak-builder flatpak ];
            text = ''
              [[ $# -lt 1 ]] && { echo "Usage: nix run .#flatpak -- <version>"; exit 1; }
              REPO="$(git rev-parse --show-toplevel)"
              MANIFEST="$REPO/io.github.moku_project.Moku.yml"

              rm -rf "$REPO/build-dir" "$REPO/repo"
              flatpak-builder \
                --repo="$REPO/repo" \
                --force-clean \
                "$REPO/build-dir" \
                "$MANIFEST"
              flatpak build-bundle "$REPO/repo" "$REPO/moku.flatpak" io.github.moku_project.Moku
              rm -rf "$REPO/build-dir" "$REPO/repo"

              echo "moku.flatpak created"
            '';
          };

          tunnelScript = pkgs.writeShellApplication {
            name = "moku-tunnel";
            runtimeInputs = with pkgs; [ cloudflared ];
            text = ''
              PORT="''${1:-4567}"
              cloudflared tunnel --url "http://localhost:$PORT"
            '';
          };

        in
        {
          apps = {
            default       = { type = "app"; program = "${moku}/bin/moku"; };
            moku          = { type = "app"; program = "${moku}/bin/moku"; };
            bump          = { type = "app"; program = "${bumpScript}/bin/moku-bump"; };
            post-tag-bump = { type = "app"; program = "${postTagBumpScript}/bin/moku-post-tag-bump"; };
            flatpak       = { type = "app"; program = "${flatpakScript}/bin/moku-flatpak"; };
            tunnel        = { type = "app"; program = "${tunnelScript}/bin/moku-tunnel"; };
          };

          packages = {
            inherit moku frontend;
            default = moku;
          };

          devShells.default = pkgs.mkShell {
            buildInputs = runtimeLibs;
            nativeBuildInputs = with pkgs; [
              rustToolchain
              pkg-config
              wrapGAppsHook3
              nodejs_22
              pnpm
              suwayomi-server
              cloudflared
              xdg-utils
              (python3.withPackages (ps: [ ps.aiohttp ps.tomlkit ]))
            ];
            shellHook = ''
              export NO_STRIP=true
              export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"

              echo "Moku dev shell — pnpm install && pnpm tauri:dev"
              echo ""
              echo "  nix run .#bump          -- <ver>"
              echo "  git commit && git tag && git push"
              echo "  nix run .#post-tag-bump -- <ver>"
              echo "  nix run .#flatpak       -- <ver>"
              echo "  nix run .#tunnel        -- [port]"
            '';
          };

          formatter = pkgs.nixfmt-rfc-style;
        };
    };
}
