#!/bin/bash
echo $0: creating public and private key files

# Create the .ssh directory
mkdir -p ${HOME}/.ssh
chmod 700 ${HOME}/.ssh

# Create the public and private key files from the environment variables.
echo "${HEROKU_PUBLIC_KEY}" > ${HOME}/.ssh/heroku_id_rsa.pub
chmod 644 ${HOME}/.ssh/heroku_id_rsa.pub

# Note use of double quotes, required to preserve newlines
echo "${HEROKU_PRIVATE_KEY}" > ${HOME}/.ssh/heroku_id_rsa
chmod 600 ${HOME}/.ssh/heroku_id_rsa

# Preload the known_hosts file  (see "version 2" below)
echo '|1|sBi/rtSp2vStSlpM1LLeEKSdudg=|udgBlU5tuePGLTFHCeB+f6q1FhM= ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBHLMoBUMvpdE+rYgLnmQ3t2XYBLEdLGO/jwHq6g9QXoRiM4bUSL/qpmyygUT7GVLh5rEWqTFmZLRhwhWDvvdTZ8=' > ${HOME}/.ssh/known_hosts

# Start the SSH tunnel if not already running
SSH_CMD="ssh -f -i ${HOME}/.ssh/heroku_id_rsa -N -L 4321:localhost:27017 ${REMOTE_USER}@${REMOTE_MONGO_HOST}"

PID=`pgrep -f "${SSH_CMD}"`
if [ $PID ] ; then
    echo $0: tunnel already running on ${PID}
else
    echo $0 launching tunnel
    $SSH_CMD
fi