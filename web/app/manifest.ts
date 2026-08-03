import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "思考情报台",
    short_name: "收录",
    description: "把看到的内容先收录，再变成自己的判断。",
    display: "standalone",
    background_color: "#f6f5f0",
    theme_color: "#274c3b",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
