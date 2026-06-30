FROM php:8.3-cli-alpine

RUN apk add --no-cache \
    autoconf \
    g++ \
    make \
    linux-headers \
    libstdc++ \
    pkgconfig \
    brotli-dev \
    openssl-dev \
    libssl3 \
    lsof 

RUN pecl channel-update pecl.php.net \
    && pecl install swoole \
    && docker-php-ext-enable swoole

COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY ./services/ingestion/composer.json ./
RUN composer config --global jobs 16 \
    && composer install \
    --no-interaction \
    --no-plugins \
    --no-scripts \
    --prefer-dist \
    --no-progress

COPY ./services/ingestion/server.php .
COPY ./services/ingestion/phpunit.xml ./
COPY ./services/ingestion/tests/ ./tests/

RUN php server.php > /dev/null 2>&1 & \
    sleep 2 \
    && ./vendor/bin/phpunit tests/IngestionServiceTest.php \
    && kill $(lsof -t -i:8001)


EXPOSE 8001
CMD ["php", "server.php"]
