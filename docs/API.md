# Charis Prayer Walk API Documentation

## Base URL
```
Production: https://your-app.vercel.app/api
Development: http://localhost:3000/api
```

## Authentication
All endpoints (except `/auth/login` and `/auth/verify-otp`) require a Bearer token in the Authorization header:
```
Authorization: Bearer <JWT_TOKEN>
```

---

## 1. Authentication Endpoints

### 1.1 Request OTP (Login)
**Endpoint:** `POST /auth/login`

**Description:** Initiates phone-based authentication by sending an OTP code.

**Request Body:**
```json
{
  "phone": "+1234567890"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "expiresIn": 300
}
```

**Error Responses:**
- **400 Bad Request:**
```json
{
  "error": "Invalid phone number format"
}
```
- **500 Internal Server Error:**
```json
{
  "error": "Failed to send OTP"
}
```

---

### 1.2 Verify OTP
**Endpoint:** `POST /auth/verify-otp`

**Description:** Verifies the OTP code and returns a JWT token.

**Request Body:**
```json
{
  "phone": "+1234567890",
  "otp": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "phone": "+1234567890",
    "name": "John Doe",
    "branch": "Downtown",
    "role": "member"
  }
}
```

**Error Responses:**
- **400 Bad Request:**
```json
{
  "error": "Invalid or expired OTP"
}
```
- **404 Not Found:**
```json
{
  "error": "User not found"
}
```

---

### 1.3 Register User
**Endpoint:** `POST /auth/register`

**Description:** Registers a new user (typically called after OTP verification for new users).

**Request Body:**
```json
{
  "phone": "+1234567890",
  "name": "John Doe",
  "branch": "Downtown",
  "role": "member"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "phone": "+1234567890",
    "name": "John Doe",
    "branch": "Downtown",
    "role": "member"
  }
}
```

---

## 2. Prayer Walk Endpoints

### 2.1 Start Prayer Walk
**Endpoint:** `POST /walks/start`

**Description:** Initiates a new prayer walk.

**Request Body:**
```json
{
  "branch": "Downtown",
  "participantIds": ["user-uuid-1", "user-uuid-2"]
}
```

**Success Response (201):**
```json
{
  "success": true,
  "walk": {
    "id": "walk-uuid",
    "branch": "Downtown",
    "leaderId": "current-user-uuid",
    "startTime": "2026-02-16T10:30:00Z",
    "status": "active",
    "participants": [
      {
        "id": "user-uuid-1",
        "name": "John Doe"
      }
    ]
  }
}
```

**Error Responses:**
- **400 Bad Request:**
```json
{
  "error": "Branch is required"
}
```
- **401 Unauthorized:**
```json
{
  "error": "Authentication required"
}
```

---

### 2.2 Stop Prayer Walk
**Endpoint:** `POST /walks/:walkId/stop`

**Description:** Ends an active prayer walk and calculates coverage.

**Request Body:**
```json
{
  "endTime": "2026-02-16T11:30:00Z"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "walk": {
    "id": "walk-uuid",
    "branch": "Downtown",
    "startTime": "2026-02-16T10:30:00Z",
    "endTime": "2026-02-16T11:30:00Z",
    "status": "completed",
    "distanceMeters": 2543.5,
    "durationMinutes": 60,
    "participantCount": 3
  }
}
```

**Error Responses:**
- **404 Not Found:**
```json
{
  "error": "Walk not found"
}
```
- **403 Forbidden:**
```json
{
  "error": "Only the walk leader can stop this walk"
}
```

---

### 2.3 Upload GPS Route
**Endpoint:** `POST /walks/:walkId/route`

**Description:** Uploads GPS tracking data for a prayer walk.

**Request Body:**
```json
{
  "points": [
    {
      "latitude": 40.7128,
      "longitude": -74.0060,
      "accuracy": 10.5,
      "altitude": 15.2,
      "speed": 1.5,
      "timestamp": "2026-02-16T10:31:00Z"
    },
    {
      "latitude": 40.7129,
      "longitude": -74.0061,
      "accuracy": 8.3,
      "altitude": 15.5,
      "speed": 1.8,
      "timestamp": "2026-02-16T10:32:00Z"
    }
  ]
}
```

**Success Response (200):**
```json
{
  "success": true,
  "pointsAdded": 2,
  "route": {
    "type": "LineString",
    "coordinates": [
      [-74.0060, 40.7128],
      [-74.0061, 40.7129]
    ]
  }
}
```

**Error Responses:**
- **400 Bad Request:**
```json
{
  "error": "Invalid GPS data format"
}
```
- **404 Not Found:**
```json
{
  "error": "Walk not found"
}
```

---

### 2.4 Get Walk Details
**Endpoint:** `GET /walks/:walkId`

**Description:** Retrieves detailed information about a specific walk.

**Success Response (200):**
```json
{
  "success": true,
  "walk": {
    "id": "walk-uuid",
    "branch": "Downtown",
    "leader": {
      "id": "user-uuid",
      "name": "John Doe"
    },
    "startTime": "2026-02-16T10:30:00Z",
    "endTime": "2026-02-16T11:30:00Z",
    "status": "completed",
    "distanceMeters": 2543.5,
    "route": {
      "type": "LineString",
      "coordinates": [...]
    },
    "participants": [...],
    "journalEntries": [...]
  }
}
```

---

### 2.5 List Walks by Branch and Date
**Endpoint:** `GET /walks`

**Description:** Retrieves a list of walks filtered by branch and date range.

**Query Parameters:**
- `branch` (required): Branch name
- `startDate` (optional): ISO 8601 date string
- `endDate` (optional): ISO 8601 date string
- `status` (optional): active, completed, cancelled
- `limit` (optional): Number of results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Example Request:**
```
GET /walks?branch=Downtown&startDate=2026-02-01&endDate=2026-02-28&status=completed
```

**Success Response (200):**
```json
{
  "success": true,
  "walks": [
    {
      "id": "walk-uuid",
      "branch": "Downtown",
      "leaderName": "John Doe",
      "startTime": "2026-02-16T10:30:00Z",
      "endTime": "2026-02-16T11:30:00Z",
      "distanceMeters": 2543.5,
      "participantCount": 3,
      "status": "completed"
    }
  ],
  "total": 15,
  "limit": 50,
  "offset": 0
}
```

---

## 3. Prayer Journal Endpoints

### 3.1 Add Journal Entry
**Endpoint:** `POST /walks/:walkId/journal`

**Description:** Adds a prayer journal entry to a walk.

**Request Body:**
```json
{
  "text": "Prayed for the families in this neighborhood",
  "location": {
    "latitude": 40.7128,
    "longitude": -74.0060
  }
}
```

**Success Response (201):**
```json
{
  "success": true,
  "entry": {
    "id": "journal-uuid",
    "walkId": "walk-uuid",
    "userId": "user-uuid",
    "text": "Prayed for the families in this neighborhood",
    "location": {
      "type": "Point",
      "coordinates": [-74.0060, 40.7128]
    },
    "timestamp": "2026-02-16T10:45:00Z"
  }
}
```

---

### 3.2 Get Journal Entries
**Endpoint:** `GET /walks/:walkId/journal`

**Description:** Retrieves all journal entries for a specific walk.

**Success Response (200):**
```json
{
  "success": true,
  "entries": [
    {
      "id": "journal-uuid",
      "user": {
        "id": "user-uuid",
        "name": "John Doe"
      },
      "text": "Prayed for the families in this neighborhood",
      "location": {
        "type": "Point",
        "coordinates": [-74.0060, 40.7128]
      },
      "timestamp": "2026-02-16T10:45:00Z"
    }
  ]
}
```

---

## 4. Coverage & Analytics Endpoints

### 4.1 Get Branch Coverage
**Endpoint:** `GET /coverage/:branch`

**Description:** Retrieves prayer coverage data for a specific branch.

**Query Parameters:**
- `includeUnprayed` (optional): Include areas not yet prayed (default: false)

**Success Response (200):**
```json
{
  "success": true,
  "branch": "Downtown",
  "coverage": {
    "totalAreaKm2": 15.5,
    "prayedAreaKm2": 8.3,
    "coveragePercentage": 53.5,
    "totalWalks": 42,
    "totalDistanceMeters": 125430.5,
    "lastPrayedAt": "2026-02-16T11:30:00Z"
  },
  "areas": [
    {
      "id": "coverage-uuid",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[...]]
      },
      "prayerCount": 3,
      "lastPrayedAt": "2026-02-16T11:30:00Z"
    }
  ]
}
```

---

### 4.2 Get Streets Prayed
**Endpoint:** `GET /coverage/:branch/streets`

**Description:** Retrieves list of streets and their prayer coverage.

**Success Response (200):**
```json
{
  "success": true,
  "streets": [
    {
      "id": "street-uuid",
      "name": "Main Street",
      "prayerCount": 5,
      "lastPrayedAt": "2026-02-16T11:30:00Z",
      "geometry": {
        "type": "LineString",
        "coordinates": [[...]]
      }
    }
  ],
  "stats": {
    "totalStreets": 150,
    "prayedStreets": 87,
    "coveragePercentage": 58.0
  }
}
```

---

### 4.3 Get Heatmap Data
**Endpoint:** `GET /coverage/:branch/heatmap`

**Description:** Retrieves heatmap data showing prayer intensity across the branch.

**Query Parameters:**
- `gridSize` (optional): Grid cell size in meters (default: 100)
- `startDate` (optional): Filter by date range
- `endDate` (optional): Filter by date range

**Success Response (200):**
```json
{
  "success": true,
  "heatmap": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [-74.0060, 40.7128]
        },
        "properties": {
          "intensity": 5,
          "prayerCount": 12,
          "lastPrayedAt": "2026-02-16T11:30:00Z"
        }
      }
    ]
  }
}
```

---

### 4.4 Get Unprayed Areas
**Endpoint:** `GET /coverage/:branch/unprayed`

**Description:** Identifies areas within the branch that haven't been prayed over yet.

**Success Response (200):**
```json
{
  "success": true,
  "unprayedAreas": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Polygon",
          "coordinates": [[...]]
        },
        "properties": {
          "areaKm2": 0.5,
          "suggestedPriority": "high"
        }
      }
    ]
  },
  "stats": {
    "totalUnprayedAreaKm2": 7.2,
    "percentageUnprayed": 46.5
  }
}
```

---

## 5. User Endpoints

### 5.1 Get User Profile
**Endpoint:** `GET /users/me`

**Success Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "phone": "+1234567890",
    "name": "John Doe",
    "branch": "Downtown",
    "role": "member",
    "stats": {
      "totalWalks": 15,
      "totalDistanceMeters": 45230.5,
      "totalJournalEntries": 42
    }
  }
}
```

---

### 5.2 Update User Profile
**Endpoint:** `PATCH /users/me`

**Request Body:**
```json
{
  "name": "John Smith",
  "branch": "Westside"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "user-uuid",
    "name": "John Smith",
    "branch": "Westside"
  }
}
```

---

## Error Handling

All endpoints follow a consistent error response format:

```json
{
  "error": "Error message description",
  "code": "ERROR_CODE",
  "details": {} // Optional additional error details
}
```

### Common HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## Rate Limiting

API requests are rate-limited to:
- **Authentication endpoints:** 5 requests per minute per IP
- **All other endpoints:** 100 requests per minute per user

Rate limit headers are included in responses:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1645012800
```
