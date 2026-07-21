'use strict';

module.exports = ({ env }) => {
  const bucket = env('S3_BUCKET');
  if (!bucket) {
    return {};
  }

  return {
    upload: {
      config: {
        provider: 'aws-s3',
        providerOptions: {
          baseUrl: env('S3_PUBLIC_BASE_URL'),
          rootPath: env('S3_ROOT_PATH', ''),
          s3Options: {
            credentials: {
              accessKeyId: env('S3_ACCESS_KEY_ID'),
              secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
            },
            endpoint: env('S3_ENDPOINT'),
            forcePathStyle: env.bool('S3_FORCE_PATH_STYLE', true),
            region: env('S3_REGION', 'us-east-1'),
            params: {
              ACL: env('S3_ACL', 'public-read'),
              Bucket: bucket,
            },
          },
        },
        actionOptions: {
          upload: {},
          uploadStream: {},
          delete: {},
        },
      },
    },
  };
};
