FROM nginx:1.31.9-alpine-slim

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/suomiwow.conf
COPY maintenance.html /usr/share/nginx/html/maintenance.html

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
