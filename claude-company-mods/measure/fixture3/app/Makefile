.PHONY: test run docker smoke

test:
	python3 -m pytest -q

run:
	python3 -m shop.web.app

docker:
	docker compose up --build

smoke:
	./scripts/smoke.sh http://localhost:8080
