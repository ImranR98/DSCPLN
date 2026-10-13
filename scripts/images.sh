#!/usr/bin/env bash
# App registry shared by scripts/build.sh and scripts/build-all.sh.
# Sourced, never executed directly.

ALL_APPS=(portal balance-xlsx file-pipelines whatsapp-txt task-runner contacts-calendar compose-state ytmusic)

# app -> image name (repo under IMAGE_ORG)
declare -A IMAGE_NAMES=(
    [balance-xlsx]=dscpln-balance
    [file-pipelines]=dscpln-file-pipelines
    [whatsapp-txt]=dscpln-watxt
    [task-runner]=dscpln-task-runner
    [contacts-calendar]=dscpln-contacts
    [compose-state]=dscpln-compose
    [ytmusic]=dscpln-ytmusic
    [portal]=dscpln-portal
)

# app -> deployment template used by build-all.sh --pin (edit for another repo)
declare -A TEMPLATES=(
    [balance-xlsx]=dscpln.yaml
    [file-pipelines]=file-pipelines.yaml
    [whatsapp-txt]=whatsapp-txt-browser.yaml
    [task-runner]=backupctl.yaml
    [contacts-calendar]=contacts-calendar.yaml
    [compose-state]=compose-state.yaml
    [ytmusic]=ytmusic.yaml
    [portal]=portal.yaml
)
