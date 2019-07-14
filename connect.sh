eval $(grep -v -e '^#' .env | xargs -I {} echo export \'{}\')
chmod 600 secret/id_rsa
ssh -fN -l ${REMOTE_USER} -i secret/id_rsa -L 4321:127.0.0.1:27017 ${REMOTE_MONGO_HOST}
