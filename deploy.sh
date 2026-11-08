#!/usr/bin/env bash
set -u

BUCKET="s3://md2.cognotik.com"
DISTRIBUTION="E3UVO0RWXFPSKR"

die() {
  echo "$1"
  exit 1
}

build() {
  pushd packages/core || die "Failed to enter packages/core"
  npm run fix || die "Failed to build packages/core"
  npm run check || die "Failed to build packages/core"
  popd
  pushd apps/pwa || die "Failed to enter apps/pwa"
  npm run build || die "Failed to build apps/pwa"
  popd
  pushd apps/lib || die "Failed to enter apps/lib"
  npm run build || die "Failed to build apps/lib"
  popd
}

install() {
  pushd packages/core || die "Failed to enter packages/core"
  npm install || die "Failed to install packages/core"
  popd
  pushd apps/pwa || die "Failed to enter apps/pwa"
  npm install || die "Failed to install apps/pwa"
  popd
  pushd apps/lib || die "Failed to enter apps/lib"
  npm install || die "Failed to install apps/lib"
  popd
}

infra() {
  pushd terraform || die "Failed to enter terraform"
  terraform init -input=false || die "terraform init failed"
  terraform apply -input=false -auto-approve || die "terraform apply failed"
  popd
}

deploy() {
  # The reader app, at the root of the bucket.
  aws s3 cp --recursive ./apps/pwa/dist/ "$BUCKET/" || die "Failed to upload apps/pwa"

  # The library and its example page, under /lib/. File names are not hashed,
  # so keep the cache short, and drop chunks left over from earlier builds.
  aws s3 sync --delete \
    --cache-control "public, max-age=300, must-revalidate" \
    ./apps/lib/dist/ "$BUCKET/lib/" || die "Failed to upload apps/lib"

  aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION" \
    --paths "/*" || die "Failed to invalidate CloudFront"
}

install
build
#infra
deploy