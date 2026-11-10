# Lunar Vision Platform

See the [Vercel deployment and local setup guide](docs/DEPLOYMENT.md). The original EagleEye architecture notes follow.


# 🦅 EagleEye Nigeria - Intelligence Grid

**Version:** 2.4.1  
**Type:** Law Enforcement Facial Recognition & Intelligence System  
**Architecture:** Client-Side Secure SPA (React) with Cloud AI Integration

## 📋 Project Overview
EagleEye Nigeria is a specialized intelligence platform designed to replicate the functionality of systems like **Clearview AI**. It provides law enforcement agencies with advanced facial recognition, geo-spatial tracking, and link analysis capabilities to identify suspects, track high-value targets, and map criminal networks.

The system operates on a **Zero-Trust** architecture where the frontend manages logic securely, interfacing directly with biometric cloud providers (Face++) and Generative AI (Google Gemini) for forensic analysis.

---

## 🛠 Technology Stack

### Frontend Core
*   **Framework:** React 19 (TypeScript)
*   **Styling:** Tailwind CSS (Custom "Eagle" Dark Mode Theme)
*   **Icons:** Lucide React
*   **Build Tool:** Vite / Browser-Native ES Modules

### Artificial Intelligence (The "Brain")
*   **Biometrics & Recognition:** Face++ Cognitive Services (V3 API)
    *   *Detect API:* High-fidelity facial feature extraction.
    *   *Search API:* 1:N Identification against "eagleeye_db" Faceset.
    *   *Analyze API:* Age, Gender, and Emotion telemetry.
*   **Forensic Analysis:** Google Gemini 2.5 Flash
    *   Generates tentative image-condition observations for manual review; no identity, ethnicity, psychological, kinship, or threat conclusions.

### Geo-Spatial Intelligence
*   **Mapping Engine:** Leaflet.js
*   **Tiles:** CartoDB Dark Matter (Tactical Night Mode)
*   **Geocoding:** Custom Auto-Geocoding Logic for Nigerian Cities.

### Data & State
*   **Persistence:** Encrypted LocalStorage (Simulating a NoSQL Document Store).
*   **Image Optimization:** Client-side Canvas Compression (High-Res Analysis / Low-Res UI Display).

---

## 🚀 Key Features

### 1. 🕵️‍♂️ Facial Recognition Engine
*   **Dual-Layer Processing:**
    *   **Layer 1 (Biometric):** Sends raw 4K images to Face++ for high-precision token generation.
    *   **Layer 2 (UI):** Compresses images to optimized thumbnails for fast UI rendering.
*   **Candidate review:** Provider similarity scores are shown on a 0–100 scale with neutral higher/lower bands. They do not establish identity, kinship, or threat. Analysts can record a reasoned review as a case note and activity entry.
*   **Live Telemetry:** Displays real-time estimates of Age, Gender, and Emotional State.

### 2. 🌍 Geo-Spatial Intelligence (Global Map)
*   **Tactical HUD:** Full-screen interactive map plotting all known suspects.
*   **Real-Time Sync:** Auto-refreshes data every 30 seconds.
*   **Advanced Filtering:** Toggle layers for `WANTED`, `IN_CUSTODY`, `CLEARED`, or `CRAWLED` data.
*   **Route Tracing:** Calculates and draws vector lines from the Investigation Center (Abuja) to any suspect's last known location.
*   **Interactive Popups:** Direct actions inside map markers to "Update Profile" or "Trace Route".

### 3. 🔍 Search & Link Analysis
*   **Drag & Drop Investigation:** Instant analysis of uploaded probe images.
*   **Graph Visualization:** Node-link diagram showing connections between the Probe and Database Matches.
*   **Deep Web Simulation:** "Crawler" mode to simulate indexing images from public web sources.
*   **Forensic AI Report:** Gemini-powered text summary of the suspect's visual traits.

### 4. 🚨 Watchlist & Alerts
*   **High Value Targets (HVT):** Chief Commanders can tag specific IDs as `WANTED`.
*   **Analyst Review:** Source-record status and provider candidates require independent review. A score does not trigger an identity-confirmation alarm.
