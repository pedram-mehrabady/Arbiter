# API Endpoint: {{ENDPOINT_TITLE}}

## Summary
{{ENDPOINT_SUMMARY}}

## Endpoint Specification

| Field          | Value             |
|----------------|-------------------|
| Method         | {{HTTP_METHOD}}   |
| Path           | {{ENDPOINT_PATH}} |
| Auth required  | Yes / No          |
| Rate limited   | Yes / No          |

## Request

### Headers
```
Content-Type: application/json
Authorization: Bearer <token>
```

### Body
```json
{
  "field": "type — description"
}
```

## Response

### Success (2xx)
```json
{
  "field": "type — description"
}
```

### Error Responses
| Status | Code | Description |
|--------|------|-------------|
| 400    |      |             |
| 401    |      |             |
| 404    |      |             |

## Acceptance Criteria
- [ ] Endpoint returns correct response for happy path
- [ ] Auth is enforced
- [ ] Input validation rejects invalid payloads
- [ ] Integration test covers the endpoint
