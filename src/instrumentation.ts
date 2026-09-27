// Runs once when the server starts: load GeoCLIP in the background so the
// first search doesn't pay the model start-up cost.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getGeoclip } = await import("./lib/geoclip");
    void getGeoclip();
  }
}
