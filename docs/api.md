# Rep2Recall API

## Getting to token

- You will need access to user's `secret` and `POST` to `/api/login` to get a token.
- Sample body:

```json
{
    "email": "your.email@email.com",
    "secret": "<your_secret>"
}
```

- Sample response:

```json
{
    "email": "your.email@email.com",
    "token": "<your_token>"
}
```

- Afterwards, you will need the following header in all your requests:-

```json
{
    "Authorization": "Token ${secret.token}",
    "Content-Type": "application/json; charset=utf-8"
}
```

## Card editing

### Reading cards

- Endpoint: `/api/editor/`
- Method: `POST`
- Sample body:

```json
{
    "q": "deck:HSK",
    "offset": 10,
    "limit": 10
}
```


### Inserting cards

- Endpoint: `/api/editor/`
- Method: `PUT`
- Sample body:

```json
{
    "create": [
        {
            "front": "foo",
            "back": "bar"
        },
        {
            "front": "baz",
            "note": "baaq"
        }
    ]
}
```
- Sample response

```json
{
    "ids": [3, 4]
}
```

### Updating cards

- Endpoint: `/api/editor/`
- Method: `PUT`
- Sample body:

```json
{
    "ids": [3, 4],
    "update": {
        "deck": "HSK/HSK1"
    }
}
```

### Deleting cards

- Endpoint: `/api/editor/`
- Method: `DELETE`
- Sample body:

```json
{
    "ids": [3, 4]
}
```

### Editing card tags

- Endpoint: `/api/editor/`
- Method: `PUT`
- Sample body:

```json
{
    "ids": [3, 4],
    "tags": ["HSK"],
    "isAdd": true
}
```