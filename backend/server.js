const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { HfInference } = require("@huggingface/inference");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const hf = new HfInference(process.env.HUGGINGFACE_TOKEN);

// Mock database (replace with real database in production)
let users = [];
let images = [];

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

// Routes
app.post("/api/register", async (req, res) => {
  const { email, password, username } = req.body;

  if (users.find((u) => u.email === email)) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: Date.now().toString(),
    email,
    username,
    password: hashedPassword,
    tokens: 10, // Starting tokens
  };

  users.push(user);

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  res.json({
    token,
    user: { email: user.email, username: user.username, tokens: user.tokens },
  });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find((u) => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  res.json({
    token,
    user: { email: user.email, username: user.username, tokens: user.tokens },
  });
});

app.post("/api/generate-image", authenticateToken, async (req, res) => {
  try {
    const { prompt } = req.body;
    const user = users.find((u) => u.id === req.user.userId);

    if (user.tokens <= 0) {
      return res.status(400).json({ error: "Insufficient tokens" });
    }

    // Generate image using Hugging Face
    const result = await hf.textToImage({
      model: "stabilityai/stable-diffusion-2-1",
      inputs: prompt,
      parameters: {
        num_inference_steps: 50,
        guidance_scale: 7.5,
      },
    });

    // Convert blob to base64
    const arrayBuffer = await result.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const imageUrl = `data:image/jpeg;base64,${base64}`;

    // Deduct token
    user.tokens -= 1;

    // Save image record
    const imageRecord = {
      id: Date.now().toString(),
      userId: user.id,
      prompt,
      imageUrl,
      createdAt: new Date(),
    };
    images.push(imageRecord);

    res.json({
      imageUrl,
      remainingTokens: user.tokens,
      imageId: imageRecord.id,
    });
  } catch (error) {
    console.error("Generation error:", error);
    res.status(500).json({ error: "Image generation failed" });
  }
});

app.get("/api/user", authenticateToken, (req, res) => {
  const user = users.find((u) => u.id === req.user.userId);
  res.json({
    user: { email: user.email, username: user.username, tokens: user.tokens },
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
