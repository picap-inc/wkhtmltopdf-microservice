FROM surnet/alpine-node-wkhtmltopdf:22.17.0-024b2b2-full

RUN apk update && \
    apk add bash nano zip ttf-dejavu ttf-droid ttf-freefont ttf-liberation xvfb && \
    rm -rf /var/cache/apk/*

RUN mkdir -p /var/www/wkhtmltopdf-microservice
COPY ./ /var/www/wkhtmltopdf-microservice

# Set permissions for /var/www and /tmp
RUN chmod -R 777 /var/www
RUN chmod -R 777 /tmp

WORKDIR /var/www/wkhtmltopdf-microservice
RUN npm install
RUN npm run build

# Copy and set up startup script
COPY start.sh /var/www/wkhtmltopdf-microservice/start.sh
RUN chmod +x /var/www/wkhtmltopdf-microservice/start.sh

# Run as root for X11 compatibility
# USER node

ENTRYPOINT [ "/var/www/wkhtmltopdf-microservice/start.sh" ]
