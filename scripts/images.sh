#!/usr/bin/env bash
# App registry shared by scripts/build.sh, scripts/build-all.sh and CI.
# Sourced, never executed directly.

# Defaults used by local builds; CI overrides IMAGE_ORG with the repository owner.
DEFAULT_REGISTRY=ghcr.io
DEFAULT_IMAGE_ORG=imranr98

ALL_APPS=(portal balance-xlsx file-pipelines whatsapp-txt task-runner)

# app -> image name (repo under IMAGE_ORG)
declare -A IMAGE_NAMES=(
    [balance-xlsx]=dscpln-balance
    [file-pipelines]=dscpln-file-pipelines
    [whatsapp-txt]=dscpln-watxt
    [task-runner]=dscpln-task-runner
    [portal]=dscpln-portal
)

# app -> deployment template used by build-all.sh --pin (edit for another repo)
declare -A TEMPLATES=(
    [balance-xlsx]=dscpln.yaml
    [file-pipelines]=file-pipelines.yaml
    [whatsapp-txt]=whatsapp-txt-browser.yaml
    [task-runner]=backupctl.yaml
    [portal]=portal.yaml
)
