# Rep2Recall

Repeat Until Recall, by a simplified spaced-repetition interval.

## Features

- Powerful search-bar -- See [/search.md](/search.md)
- Anki import
- Complete editing of any fields
- Exposed API (at <http://rep2recall.herokuapp.com/api>) -- See [/api.md](/api.md)

## Running in development mode

- Clone the project from GitHub
- Create `.env` at project root as below. You will need either to install MongoDB or have an account at MongoDB Atlas.

```
DEFAULT_USER=<your-email@email.com>
MONGO_URI=<your-mongo-uri>
```

- `yarn install`, `yarn run build` and `yarn start`.

## Download a standalone executable, without having to install MongoDB

See <https://github.com/patarapolw/rep2recall>
