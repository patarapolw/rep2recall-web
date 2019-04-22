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

## Inserting cards

- Endpoint: `/api/card/insertMany`
- Method: `POST`
- Sample body:

```json
{
    "cards": [
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
