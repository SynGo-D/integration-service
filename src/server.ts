import dotenv from "dotenv";
import app from "./app";

/*
 * Load environment variables from the .env file.
 */
dotenv.config();

const PORT = process.env.PORT || 5001;

/*
 * Start the HTTP server.
 */
app.listen(PORT, () => {
    console.log(`Integration Service running on port ${PORT}`);
});