FROM surnet/alpine-node-wkhtmltopdf:22.17.0-024b2b2-full

RUN apk update
RUN apk add bash
RUN apk add nano
RUN apk add zip
RUN apk add ttf-dejavu ttf-droid ttf-freefont ttf-liberation

RUN mkdir /var/www
COPY ./ /var/www/wkhtmltopdf-microservice

# Set permissions for /var/www and /tmp
RUN chmod -R 777 /var/www
RUN chmod -R 777 /tmp

WORKDIR /var/www/wkhtmltopdf-microservice
RUN npm install
RUN npm run build

# Use node user for better security
USER node

ENTRYPOINT [ "/var/www/wkhtmltopdf-microservice/start-server.sh" ]
