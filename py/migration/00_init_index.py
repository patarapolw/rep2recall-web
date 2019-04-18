from py.migration.conn import collection
import pymongo

if __name__ == "__main__":
    collection.user.create_index([("email", pymongo.TEXT)], unique=True)
    collection.deck.create_index([("userId", 1), ("name", 1)], unique=True)
    collection.card.create_index([("userId", 1), ("front", 1)], unique=True)
    collection.media.create_index([("sourceId", 1), ("h", 1)], unique=True)
