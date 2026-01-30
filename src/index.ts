import app from "./app";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "localhost";

app.listen(PORT, HOST, () => {
  console.log(`🚀 Backend running at http://${HOST}:${PORT}`);
});
