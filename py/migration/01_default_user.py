from py.migration.conn import collection
import pymongo
import os

if __name__ == "__main__":
    if os.getenv("DEFAULT_USER"):
        collection.user.insert_one({
            "email": os.getenv("DEFAULT_USER"),
            "secret": "wasp-amusing-absolute-mangle-division-jersey-tabby-wrangle-geologist-universal-racism-regulate-enactment"
        })
