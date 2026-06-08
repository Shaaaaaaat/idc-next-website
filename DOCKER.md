# Docker: сборка и запуск

## Быстрый старт

```bash
# 1. Собрать образ
docker build -t ido-calisthenics .

# 2. Запустить контейнер (порт 8080)
docker run -p 8080:8080 ido-calisthenics

# 3. Открыть в браузере
# http://localhost:8080
```

## Свой ID счётчика при сборке

```bash
docker build --build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=107091121 -t ido-calisthenics .
```

## Проверка

```bash
# Убедиться, что образ есть
docker images | grep ido-calisthenics

# Запущен ли контейнер
docker ps

# Остановить
docker stop <container_id>
# или: docker stop $(docker ps -q --filter ancestor=ido-calisthenics)
```

## Для Yandex Cloud Serverless Containers

1. В CI/CD или при ручной сборке передать build-arg:
   ```bash
   docker build --build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=107091121 -t <registry>/ido-calisthenics .
   ```

2. Либо в Dockerfile уже задано значение по умолчанию (107091121), поэтому отдельно передавать не обязательно.
