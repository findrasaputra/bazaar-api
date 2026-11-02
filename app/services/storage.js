const crypto = require("crypto");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  endpoint: process.env.SPACES_ENDPOINT,
  region: process.env.SPACES_REGION,
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
});

exports.uploadFile = async (file, folder) => {
  const key = `${folder}/${crypto.randomBytes(1).toString("hex")}-${file.originalname}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.SPACES_BUCKET,
    Key: key,
    Body: fs.createReadStream(file.path),
    ACL: "public-read",
    ContentType: file.mimetype,
  }));
  return `${process.env.SPACES_CDN}/${key}`;
};
