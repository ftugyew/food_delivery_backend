// middleware/logger.js - Production-ready request logger
const logger = (req, res, next) => {
  // Skip logging for static files (reduces noise)
  if (
    req.path.startsWith('/uploads/') || 
    req.path.endsWith('.jpg') || 
    req.path.endsWith('.png') || 
    req.path.endsWith('.gif') ||
    req.path.endsWith('.ico')
  ) {
    return next();
  }

  const startTime = Date.now();

  // Capture response when it finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const user = req.user?.id ?? req.user?.email ?? 'public';
    
    // Color-code by status
    let emoji = '✅';
    if (statusCode >= 500) emoji = '❌';
    else if (statusCode >= 400) emoji = '⚠️';
    else if (statusCode >= 300) emoji = '↩️';

    console.log(
      `${emoji} ${req.method} ${req.originalUrl} ${statusCode} ${duration}ms | User: ${user}`
    );
  });

  next();
};

module.exports = logger;
