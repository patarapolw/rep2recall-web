#!/bin/bash
# See https://github.com/kollegorna/heroku-buildpack-autossh
echo $0: creating public and private key files

# Create the .ssh directory
mkdir -p ${HOME}/.ssh
chmod 700 ${HOME}/.ssh

# Create the public and private key files from the environment variables.
echo "${HEROKU_PUBLIC_KEY}" > ${HOME}/.ssh/id_rsa.pub
chmod 644 ${HOME}/.ssh/id_rsa.pub

# Note use of double quotes, required to preserve newlines
echo "${HEROKU_PRIVATE_KEY}" > ${HOME}/.ssh/id_rsa
chmod 600 ${HOME}/.ssh/id_rsa

# Auto add the host to known_hosts
ssh-keyscan ${REMOTE_MONGO_HOST} >> ${HOME}/.ssh/known_hosts

# Start the SSH tunnel if not already running
autossh -M 33306 -f -N -o "ServerAliveInterval 10" -o "ServerAliveCountMax 3"  -L 4321:localhost:27017 ${REMOTE_USER}@${REMOTE_MONGO_HOST}
