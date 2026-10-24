import { writeFile } from "node:fs/promises";

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
const placeId = process.env.GOOGLE_PLACE_ID;

if (!apiKey) throw new Error("Missing GOOGLE_PLACES_API_KEY");
if (!placeId) throw new Error("Missing GOOGLE_PLACE_ID");

const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

const response = await fetch(url, {
  headers: {
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": "rating,userRatingCount",
  },
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`Places API failed: ${response.status} ${response.statusText} - ${body}`);
}

const data = await response.json();

if (typeof data.rating !== "number") {
  throw new Error("Places API response missing rating");
}
if (!Number.isInteger(data.userRatingCount)) {
  throw new Error("Places API response missing userRatingCount");
}

const output = {
  googleRating: data.rating,
  googleReviewCount: data.userRatingCount,
  source: "google-places-api-new",
  updatedAt: new Date().toISOString(),
};

await writeFile(
  new URL("../data/google-reviews.json", import.meta.url),
  JSON.stringify(output, null, 2) + "\n",
  "utf8",
);

console.log(`Updated Google reviews: rating=${output.googleRating}, count=${output.googleReviewCount}`);
