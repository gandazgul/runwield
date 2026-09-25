# Manual QA for remote-ssh-development

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="remote-ssh-development/01-establish-the-remote-connection-and-matched-runtime" -->

## Establish the Remote Connection and Matched Runtime

Manual verification steps for remote-ssh-development/01-establish-the-remote-connection-and-matched-runtime

- [ ] On a supported Linux host, connect to an existing remote folder and confirm the displayed host and canonical
      directory match the remote location.
- [ ] Connect without a path and confirm RunWield opens the remote home directory.
- [ ] Confirm the connection view states that user turns are unavailable, shows the OpenSSH/SFTP access notice, and
      provides an exit control.
- [ ] Try text, slash-command, and shell-shortcut input; confirm none starts a turn or changes remote project or
      personal data.
- [ ] Exit with the displayed control and with Ctrl-C; confirm the connection-owned processes stop and unrelated
      processes remain running.
- [ ] Test a missing folder or failed SSH connection; confirm RunWield reports the cause and does not create the folder
      or leave a usable connection.

<!-- runwield:manual-qa:end child="remote-ssh-development/01-establish-the-remote-connection-and-matched-runtime" -->
