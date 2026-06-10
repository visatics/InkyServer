export const DEVICE = {
  uuid: process.env.DEVICE_UUID!, // the public key the client uses
  name: "Spike Inky Frame 5.7",
  width: 600, // Inky Frame 5.7" (PRD §2)
  height: 448,
  buttonCount: 5,
  defaultScreen: 1,
};

export const SCREEN = {
  ordinal: 1,
  provider: "slideshow" as const,
  refreshMinutes: 1, // small for easy testing; PRD §7.2
  config: {
    order: "sequential" as "sequential" | "random",
    fit: "cover" as "cover" | "contain",
  },
  configVersion: 1, // bump to bust the render cache
};

// Bundled, committed sample images, in display order.
export const SLIDESHOW_ASSETS = [
  "assets/slideshow/01.jpg",
  "assets/slideshow/02.jpg",
  "assets/slideshow/03.jpg",
];
