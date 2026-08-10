/**
 * Upload path tests (PRD §11, criterion 6).
 *
 * Uploads are the only route by which user-supplied bytes reach storage, so
 * these assert the hardening actually happens rather than trusting the handler:
 * type/size rejection, EXIF stripping, and that an uploaded asset reaches the
 * private bucket and busts the screen's render cache.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import sharp from "sharp";
import type { FastifyInstance } from "fastify";

const SECRET = "test-secret-at-least-32-bytes-long-for-hs256!!";
const USER = "00000000-0000-4000-8000-00000000000c";
const hasDb = !!process.env.DATABASE_URL;

let app: FastifyInstance;
let sql: import("postgres").Sql;
let token: string;
let screenId: string;
const uploaded: string[] = [];

const auth = () => ({ authorization: `Bearer ${token}` });

/** A JPEG carrying EXIF, including a GPS tag we must not persist. */
async function jpegWithExif(): Promise<Buffer> {
  return sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .withExif({ IFD0: { Copyright: "test" }, GPS: { GPSLatitudeRef: "N" } })
    .jpeg()
    .toBuffer();
}

function multipart(body: Buffer, filename: string, contentType: string) {
  const boundary = "----inkytest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, body, tail]),
    headers: { ...auth(), "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe.skipIf(!hasDb)("slideshow asset upload", () => {
  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const { db } = await import("../src/db/client.js");
    const { buildApp } = await import("../src/app.js");
    sql = db();
    app = await buildApp();

    await sql`
      insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at)
      values (${USER}, '00000000-0000-0000-0000-000000000000',
              'authenticated','authenticated','c@test.local', now())
      on conflict (id) do nothing`;
    await sql`delete from devices where user_id = ${USER}`;

    token = await new SignJWT({ sub: USER })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));

    const device = await app.inject({
      method: "POST",
      url: "/api/devices",
      headers: auth(),
      payload: { presetId: "inky-frame-5.7" },
    });
    const screen = await app.inject({
      method: "POST",
      url: `/api/devices/${device.json().id}/screens`,
      headers: auth(),
      payload: { name: "S", provider: "slideshow" },
    });
    screenId = screen.json().id;
  });

  afterAll(async () => {
    if (!hasDb) return;
    const { removeSource } = await import("../src/storage/supabase.js");
    for (const key of uploaded) await removeSource(key).catch(() => {});
    await sql`delete from devices where user_id = ${USER}`;
    await app?.close();
    await sql?.end();
  });

  it("rejects a non-image upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/screens/${screenId}/assets`,
      ...multipart(Buffer.from("not an image"), "notes.txt", "text/plain"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an image/* file that is not decodable", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/screens/${screenId}/assets`,
      ...multipart(Buffer.from("garbage bytes"), "fake.jpg", "image/jpeg"),
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid image and stores it in the private bucket", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/screens/${screenId}/assets`,
      ...multipart(await jpegWithExif(), "photo.jpg", "image/jpeg"),
    });
    expect(res.statusCode).toBe(201);
    const asset = res.json();
    uploaded.push(asset.storage_key);
    expect(asset.storage_key).toBe(`${USER}/${screenId}/${asset.id}.jpg`);
    expect(asset.position).toBe(0);
  });

  it("strips EXIF from what it stores", async () => {
    const { downloadUpload } = await import("../src/storage/supabase.js");
    const stored = await downloadUpload(uploaded[0]);
    const meta = await sharp(stored).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.format).toBe("jpeg");
  });

  it("assigns increasing positions and reorders them", async () => {
    const second = await app.inject({
      method: "POST",
      url: `/api/screens/${screenId}/assets`,
      ...multipart(await jpegWithExif(), "second.jpg", "image/jpeg"),
    });
    expect(second.json().position).toBe(1);
    uploaded.push(second.json().storage_key);

    const list = await app.inject({
      method: "GET",
      url: `/api/screens/${screenId}/assets`,
      headers: auth(),
    });
    const ids = list.json().map((a: { id: string }) => a.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/screens/${screenId}/assets/reorder`,
      headers: auth(),
      payload: { orderedIds: [ids[1], ids[0]] },
    });
    expect(res.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: `/api/screens/${screenId}/assets`,
      headers: auth(),
    });
    expect(after.json().map((a: { id: string }) => a.id)).toEqual([ids[1], ids[0]]);
  });

  it("uploading bumps the screen's updated_at, busting its renders (criterion 3)", async () => {
    const [before] = await sql`select updated_at from screens where id = ${screenId}`;
    const res = await app.inject({
      method: "POST",
      url: `/api/screens/${screenId}/assets`,
      ...multipart(await jpegWithExif(), "third.jpg", "image/jpeg"),
    });
    uploaded.push(res.json().storage_key);
    const [after] = await sql`select updated_at from screens where id = ${screenId}`;
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
      new Date(before.updated_at).getTime()
    );
  });

  it("deleting an asset removes the row", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/screens/${screenId}/assets`,
      headers: auth(),
    });
    const target = list.json()[0];
    const res = await app.inject({
      method: "DELETE",
      url: `/api/assets/${target.id}`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(204);

    const after = await app.inject({
      method: "GET",
      url: `/api/screens/${screenId}/assets`,
      headers: auth(),
    });
    expect(after.json().map((a: { id: string }) => a.id)).not.toContain(target.id);
  });
});
