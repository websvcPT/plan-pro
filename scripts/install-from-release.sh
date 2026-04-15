#!/usr/bin/env bash
set -euo pipefail

PLAN_PRO_REPO="${PLAN_PRO_REPO:-${REPO:-}}"
PLAN_PRO_ARCHIVE_URL="${PLAN_PRO_ARCHIVE_URL:-}"
PLAN_PRO_ARCHIVE_FILE="${PLAN_PRO_ARCHIVE_FILE:-}"
VERSION_INPUT="${VERSION:-latest}"
COPILOT_HOME="${COPILOT_HOME:-$HOME/.copilot}"

normalize_tag() {
  local value="$1"
  if [[ -z "$value" || "$value" == "latest" ]]; then
    printf '%s' "$value"
    return
  fi
  if [[ "$value" == v* ]]; then
    printf '%s' "$value"
  else
    printf 'v%s' "$value"
  fi
}

resolve_latest_tag() {
  local repo="$1"
  local latest_url
  latest_url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${repo}/releases/latest")"
  if [[ "$latest_url" != *"/releases/tag/"* ]]; then
    printf 'Could not resolve latest release tag for %s\n' "$repo" >&2
    exit 1
  fi
  printf '%s' "${latest_url##*/}"
}

fail_missing_repo() {
  printf 'Set PLAN_PRO_REPO=OWNER/REPO (or REPO=OWNER/REPO) to install from GitHub releases.\n' >&2
  exit 1
}

TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="$TMP_DIR/plan-pro-release.tar.gz"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

REQUESTED_VERSION=""
INSTALL_SOURCE="github-release"

if [[ -n "$PLAN_PRO_ARCHIVE_FILE" ]]; then
  cp "$PLAN_PRO_ARCHIVE_FILE" "$ARCHIVE_PATH"
  if [[ "$VERSION_INPUT" != "latest" ]]; then
    REQUESTED_VERSION="$(normalize_tag "$VERSION_INPUT")"
  fi
  INSTALL_SOURCE="release-archive"
elif [[ -n "$PLAN_PRO_ARCHIVE_URL" ]]; then
  curl -fsSL "$PLAN_PRO_ARCHIVE_URL" -o "$ARCHIVE_PATH"
  if [[ "$VERSION_INPUT" != "latest" ]]; then
    REQUESTED_VERSION="$(normalize_tag "$VERSION_INPUT")"
  fi
else
  [[ -n "$PLAN_PRO_REPO" ]] || fail_missing_repo
  if [[ "$VERSION_INPUT" == "latest" ]]; then
    REQUESTED_VERSION="$(resolve_latest_tag "$PLAN_PRO_REPO")"
  else
    REQUESTED_VERSION="$(normalize_tag "$VERSION_INPUT")"
  fi
  curl -fsSL "https://github.com/${PLAN_PRO_REPO}/archive/refs/tags/${REQUESTED_VERSION}.tar.gz" -o "$ARCHIVE_PATH"
fi

tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
EXTRACTED_ROOT="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)"

if [[ -z "$EXTRACTED_ROOT" || ! -f "$EXTRACTED_ROOT/scripts/install.sh" ]]; then
  printf 'Downloaded archive does not look like a plan-pro release package.\n' >&2
  exit 1
fi

PLAN_PRO_INSTALL_SOURCE="$INSTALL_SOURCE" \
PLAN_PRO_REPOSITORY="$PLAN_PRO_REPO" \
PLAN_PRO_REQUESTED_VERSION="$REQUESTED_VERSION" \
PLAN_PRO_SOURCE_ROOT="" \
COPILOT_HOME="$COPILOT_HOME" \
bash "$EXTRACTED_ROOT/scripts/install.sh"

if [[ -n "$PLAN_PRO_REPO" ]]; then
  printf '\nInstalled from %s' "$PLAN_PRO_REPO"
  if [[ -n "$REQUESTED_VERSION" ]]; then
    printf ' (%s)' "$REQUESTED_VERSION"
  fi
  printf '.\n'
fi
