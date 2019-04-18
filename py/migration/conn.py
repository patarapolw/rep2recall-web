import py.config
from pymongo import MongoClient
import os

assert os.getenv("MONGO_URI") != None

client = MongoClient(os.getenv("MONGO_URI"))
collection = client.rep2recall
